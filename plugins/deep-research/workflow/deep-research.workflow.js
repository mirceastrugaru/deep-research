export const meta = {
  name: 'deep-research-loop',
  description: 'Autonomous research round-loop: assign, research, score, synthesize, branch the tree, stop at the round cap',
  whenToUse: 'Spawned by the deep-research skill after intake produces a config. Runs the unattended round-loop and returns the final state.',
  phases: [
    { title: 'Research' },
    { title: 'Score' },
    { title: 'Synthesize' },
  ],
}

// =============================================================================
// INLINE CORE LOGIC — kept in sync with workflow/research-core.mjs (tested).
// The sandbox cannot import; this is a verbatim copy of the tested module.
// =============================================================================

function dirId(name, salt = '') {
  let h = 0x811c9dc5;
  const s = name + ' ' + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 'd-' + h.toString(16).padStart(8, '0').slice(0, 6);
}

// ---- Roadmap model -----------------------------------------------------------

// coverage stance values
const NO = 'no';
const YES = 'yes';
const FAILED = 'FAILED_NEEDS_RERUN';

// Build the in-memory roadmap from the intake config's starting directions.
function loadRoadmap(directions) {
  return {
    dirs: directions.map((d, i) => ({
      id: d.id || dirId(d.name, String(i)),
      name: d.name,
      note: d.note || '',
      parent: d.parent || '-',
      depth: d.depth || 0, // 0 = seed/root; parent depth + 1 for a child
      status: 'open', // open | covered | saturated | closed | killed
      supportive: NO,
      adversarial: NO,
    })),
  };
}

function findDir(roadmap, id) {
  return roadmap.dirs.find((d) => d.id === id);
}

// A direction is covered once BOTH stances are yes. A FAILED stance never counts
// toward covered. killed/saturated directions are not "open work".
function isCovered(d) {
  return d.supportive === YES && d.adversarial === YES;
}

function hasFailedStance(d) {
  return d.supportive === FAILED || d.adversarial === FAILED;
}

// ---- Worker assignment (SKILL.md Step 3 priority order, deterministic) -------
//
// Priority, highest first (matches the round-cap/tree model in SKILL.md):
//   1. FAILED_NEEDS_RERUN stances — known holes, re-run before anything new.
//   2. Unstarted stances (no) on directions with NEITHER stance started.
//   3. Single-stance directions — one stance settled, the other unstarted.
//   4. Deepen the tree — child directions (depth > 0) the judge spawned, ranked
//      shallower-depth first so the tree widens before any branch runs deep.
//   5. Saturated / closed directions — lowest; re-touch only if nothing above.
// Split stances evenly across the round; fill remaining slots down the order.

function assignWorkers(roadmap, workerCount) {
  const live = roadmap.dirs.filter((d) => d.status !== 'killed' && d.status !== 'closed');

  const slots = []; // {dirId, stance, prio, depth}
  const want = (d, stance) => {
    const v = d[stance];
    return v === NO || v === FAILED;
  };

  // Bucket 1: failed stances.
  for (const d of live) {
    for (const stance of ['supportive', 'adversarial']) {
      if (d[stance] === FAILED) slots.push({ dirId: d.id, stance, prio: 1, depth: d.depth });
    }
  }
  // Bucket 2: directions with neither stance started (seeds first via depth sort).
  for (const d of live) {
    if (d.supportive === NO && d.adversarial === NO && (d.depth || 0) === 0) {
      slots.push({ dirId: d.id, stance: 'supportive', prio: 2, depth: 0 });
      slots.push({ dirId: d.id, stance: 'adversarial', prio: 2, depth: 0 });
    }
  }
  // Bucket 3: single-stance directions (one settled yes, other unstarted no).
  for (const d of live) {
    if (d.supportive === YES && d.adversarial === NO) {
      slots.push({ dirId: d.id, stance: 'adversarial', prio: 3, depth: d.depth });
    } else if (d.adversarial === YES && d.supportive === NO) {
      slots.push({ dirId: d.id, stance: 'supportive', prio: 3, depth: d.depth });
    }
  }
  // Bucket 4: deepen the tree — unstarted child directions (depth > 0).
  for (const d of live) {
    if ((d.depth || 0) > 0 && d.supportive === NO && d.adversarial === NO) {
      slots.push({ dirId: d.id, stance: 'supportive', prio: 4, depth: d.depth });
      slots.push({ dirId: d.id, stance: 'adversarial', prio: 4, depth: d.depth });
    }
  }
  // Bucket 5: saturated directions — re-touch lowest priority.
  for (const d of live) {
    if (d.status === 'saturated') {
      for (const stance of ['supportive', 'adversarial']) {
        if (want(d, stance)) slots.push({ dirId: d.id, stance, prio: 5, depth: d.depth });
      }
    }
  }

  // De-dupe (a stance could be in two buckets): keep best prio.
  const seen = new Map();
  for (const s of slots) {
    const key = `${s.dirId}:${s.stance}`;
    if (!seen.has(key) || seen.get(key).prio > s.prio) seen.set(key, s);
  }
  // Order by priority, then shallower depth first (widen the tree before deepening).
  const ordered = [...seen.values()].sort((a, b) => a.prio - b.prio || (a.depth || 0) - (b.depth || 0));

  // Take up to workerCount, then balance stances within the taken set by
  // walking the ordered list and preferring to keep supportive/adversarial even.
  const taken = ordered.slice(0, workerCount);
  return taken.map(({ dirId, stance, prio }, i) => ({
    dirId,
    stance,
    agentK: i + 1,
    isRerun: prio === 1, // bucket 1 = a stance that failed verification before
  }));
}

// ---- Apply this round's scores to the roadmap (deterministic) ----------------
//
// scored: [{ dirId, stance, score, failed }]  (failed = hard-gate fail, score 0)
// A passing stance (score > 0) -> yes. A hard-gate failure -> FAILED_NEEDS_RERUN.
function applyScores(roadmap, scored) {
  for (const s of scored) {
    const d = findDir(roadmap, s.dirId);
    if (!d) continue;
    if (s.score > 0) d[s.stance] = YES;
    else d[s.stance] = FAILED;
  }
  // Recompute status for each live direction.
  for (const d of roadmap.dirs) {
    if (d.status === 'killed') continue;
    if (hasFailedStance(d)) {
      d.status = 'open'; // never covered/saturated while a stance failed
    } else if (isCovered(d)) {
      d.status = d.status === 'saturated' ? 'saturated' : 'covered';
    }
  }
}

// Normalize a direction name for dedup: lowercase, collapse whitespace, strip
// trailing parenthetical tags and punctuation the model varies between rounds.
function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Resolve a parent reference to a direction. Accepts a d- id, the parent's exact
// name, or a normalized-name match. Returns the direction or null. This is what
// lets a child link to its parent when the synthesizer supplies a name, not an id.
function resolveParent(roadmap, parent) {
  if (!parent || parent === '-') return null;
  const byId = findDir(roadmap, parent);
  if (byId) return byId;
  const key = normName(parent);
  if (!key) return null;
  return roadmap.dirs.find((d) => normName(d.name) === key) || null;
}

// Add a brand-new direction proposed by the synthesizer (or a Phase-D closer).
// reopen=true resets coverage on an existing direction (Phase-D fix for issue A).
// Dedup is by id first, then by normalized name — the synthesizer re-proposes the
// same gap across rounds, so a name match must NOT create a duplicate direction.
function addOrReopenDirection(roadmap, { id, name, note, parent }, reopen = false) {
  let existing = id ? findDir(roadmap, id) : null;
  if (!existing && name) {
    const key = normName(name);
    existing = roadmap.dirs.find((d) => normName(d.name) === key);
  }
  if (existing) {
    if (reopen) {
      existing.supportive = NO;
      existing.adversarial = NO;
      existing.status = 'open';
      if (note) existing.note = note;
    }
    return existing;
  }
  // Resolve parent by id first, then by normalized name. The synthesizer often
  // returns the parent as a label ("(a) Models and API") rather than a d- id, so
  // a name match is what actually links the tree and gives the child depth + 1.
  const parentDir = resolveParent(roadmap, parent);
  const d = {
    id: id || dirId(name, String(roadmap.dirs.length)),
    name,
    note: note || '',
    parent: parentDir ? parentDir.id : '-', // store the resolved id, not the label
    depth: parentDir ? (parentDir.depth || 0) + 1 : 0,
    status: 'open',
    supportive: NO,
    adversarial: NO,
  };
  roadmap.dirs.push(d);
  // Cap at ~15 active directions: drop the oldest covered direction with no
  // failed stance AND no live child (killing a parent would orphan its child and
  // corrupt the tree, so a direction that still has a non-killed child is spared).
  const active = roadmap.dirs.filter((x) => x.status !== 'killed');
  if (active.length > 15) {
    const hasLiveChild = (p) =>
      roadmap.dirs.some((c) => c.parent === p.id && c.status !== 'killed');
    const victim = roadmap.dirs.find(
      (x) => x.status === 'covered' && !hasFailedStance(x) && !hasLiveChild(x)
    );
    if (victim) victim.status = 'killed';
  }
  return d;
}

// ---- Stop condition (SKILL.md Step 4) ---------------------------------------
//
// The round cap is the ONLY stop. There is no early "converged" exit: the loop
// does not stop because coverage looks complete or because a round added no new
// directions. The run explores for the full budget of rounds, then stops. This
// matches the 1.6+ tree model — the judge branches the tree each round; the run
// length is exactly round_cap, set at intake.
function shouldStop(round, roundCap) {
  return round >= roundCap;
}

// ---- Markdown flush (legibility + cross-session resume backstop) -------------

function roadmapToMarkdown(roadmap) {
  const lines = ['# Roadmap', ''];
  for (const d of roadmap.dirs) {
    lines.push(`## ${d.id}: ${d.name}`);
    lines.push(`status: ${d.status}`);
    lines.push(`parent: ${d.parent}`);
    lines.push(`depth: ${d.depth || 0}`);
    const passing = d.supportive === YES || d.adversarial === YES ? YES : NO;
    lines.push(
      `coverage: supportive=${d.supportive} adversarial=${d.adversarial} passing=${passing}`
    );
    lines.push(`note: ${d.note}`);
    lines.push('');
  }
  return lines.join('\n');
}

// "converged" here means "loop finished" (hit the round cap), not "topic
// exhausted" — the round cap is the only stop in the tree model.

// =============================================================================
// SCHEMAS (verbatim from workflow/schemas.mjs)
// =============================================================================

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['findingsFile', 'observationCount', 'newDirections'],
  properties: {
    findingsFile: { type: 'string' }, observationCount: { type: 'integer', minimum: 0 },
    wroteFile: { type: 'boolean' },
    newDirections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'reason'], properties: { name: { type: 'string' }, reason: { type: 'string' } } } },
  },
}
const SCORE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['dirId', 'stance', 'score', 'failed', 'gates'],
  properties: {
    dirId: { type: 'string' }, stance: { type: 'string', enum: ['supportive', 'adversarial'] },
    score: { type: 'integer', minimum: 0 }, failed: { type: 'boolean' },
    gates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['gate', 'pass', 'reason'], properties: { gate: { type: 'string' }, pass: { type: 'boolean' }, reason: { type: 'string' } } } },
  },
}
const SYNTH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['synthesisFile', 'evidenceFile', 'wordCount', 'newDirections', 'phaseDFlags'],
  properties: {
    synthesisFile: { type: 'string' }, evidenceFile: { type: 'string' }, wordCount: { type: 'integer', minimum: 0 },
    newDirections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'note'], properties: { name: { type: 'string' }, note: { type: 'string' }, parent: { type: 'string' } } } },
    phaseDFlags: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'description', 'closesWith'], properties: {
      kind: { type: 'string', enum: ['recency', 'contradiction', 'reachable_fact', 'omission', 'spine'] },
      description: { type: 'string' },
      closesWith: { type: 'object', additionalProperties: false, required: ['name', 'note'], properties: { reopenId: { type: 'string' }, name: { type: 'string' }, note: { type: 'string' } } },
    } } },
  },
}

// =============================================================================
// PROMPT BUILDERS
// =============================================================================

function workerPrompt(cfg, a, round, dirName, dirNote) {
  const path = `${cfg.workingDir}/findings/round-${round}/agent-${a.agentK}.md`
  return `Research goal: ${cfg.goal}
Audience for the final document: ${cfg.audience}

Your direction: ${a.dirId} — ${dirName}${dirNote ? ` (${dirNote})` : ''}
Your stance: ${a.stance}

Write your findings file to: ${path}
${cfg.sourcesDir ? `Source files (read-only): ${cfg.sourcesDir}` : ''}
${a.isRerun ? `\nNOTE: a prior attempt at this direction+stance FAILED source verification (claims that did not trace to their cited pages, or numbers taken from aggregators/blogs instead of primary sources). Do not repeat that. For every quantitative claim, open the primary source (the vendor's own docs, pricing page, model card, filing, or release note) and quote the figure from it; if a number lives only on an aggregator or a secondary blog, label it as such or drop it. A smaller set of fully-primary-sourced facts beats a long list that fails verification.\n` : ''}
You are an EVIDENCE COLLECTOR, not an analyst. Your job is to find facts, source
them, and group them. You do NOT interpret, draw conclusions, weigh one reading
against another, or argue the direction; a later stage does all of that. If you
mix interpretation in, you bias the collection toward what you already concluded.
There is NO "Inferences" section in your output and no prose that says what the
evidence MEANS. Stance (supportive/adversarial) sets which evidence you HUNT for
(confirming vs disconfirming), not what you conclude; a fact is worded the same
whichever stance found it.

Method: work in passes (search, then sort facts from open gaps, then search only
to close a named gap). Hard sourcing rules:
- NEVER guess or construct a URL. Reach a page via WebSearch, then WebFetch a URL
  from those results. Every fact carries the FULL https:// URL of the exact page
  it came from, copied from the page, never a bare domain.
- For a load-bearing number, fetch the top 3-5 results, not just the first; the
  newest/superseding fact is often below the first hit. Reconcile conflicts and
  cite the primary source.
- ACCURACY IS THE TOP PRIORITY. For every load-bearing number, date, limit, or
  rate, paste the exact words from the page in quotes right next to your fact, so
  the figure provably traces. Format: your fact, then \`(source quote: "...")\`.
  If you cannot copy a verbatim snippet from the fetched page that states the
  number, you do NOT have that fact: drop it or write it as EVIDENCE LIMIT. Never
  paraphrase a number into a different one, never round or restate units (a "per
  two-core server" price is not "per socket"; "65221 bytes" is not "644,335
  keys"). A wrong number that fails verification sinks the whole file; a smaller
  set of exactly-quoted facts is worth far more. Numbers from aggregators/blogs
  are secondary: label them secondary or drop them.
- The subject's own materials (vendor site, deck, README) are CLAIMS, tag them as
  such; do not let one carry a load-bearing fact alone.
- After ~5 failed searches on the same number, write "EVIDENCE LIMIT: <claim>" and
  move on. Never fabricate.

Write the findings file in EXACTLY this structure (no other sections):

**Direction:** one sentence: what you investigated.

**Observations:**
Group facts under short "### Sub-topic" headings so related evidence sits
together. Under each heading, one fact per line:
- Named fact. Source name, FULL https:// URL of the exact page, date, figure. [decision-changing] if it plainly matters more than its neighbours.

**Couldn't find:**
- What you sought, how many sources, why it failed. EVIDENCE LIMIT lines here.

**New directions:**
- <sub-topic>: parent ${a.dirId}. Reason: one line.

You MUST write the findings file before returning; the file on disk is the only
deliverable. Then return the structured summary: the file path you wrote, the
observation count, whether the file is on disk, and any new directions you
spotted outside your own (name + one-line reason each).`
}

function scorerPrompt(cfg, f, dirName) {
  return `You score ONE research findings file. Do exactly this one job: verify,
then score. Do NOT synthesize, write any file, or curate a roadmap. Your only
output is the structured verdict you return.

Research goal: ${cfg.goal}
Audience: ${cfg.audience}
Direction: ${f.dirId} — ${dirName}. Stance: ${f.stance}.
Findings file (read it fully): ${f.findingsFile}

VERIFY FIRST. List every quantitative claim (number, date, rate). For each, fetch
ITS CITED SOURCE only and check the source supports the claim as written; a claim
whose source does not contain it, or contradicts it, is unverified. Fetch only
the URLs the worker cited — do NOT research the topic yourself or chase leads the
worker did not raise. While a source is open, note context-stripping (context the
source gives that the claim omits and that changes its meaning).

The worker is an EVIDENCE COLLECTOR, not an analyst. It must NOT interpret, draw
conclusions, weigh readings, or argue the direction; a later stage does that.
Score the file on how good the COLLECTED EVIDENCE is, not on reasoning. A file
that argues a case or states what the facts mean is doing the wrong job: do not
reward it, and note prose conclusions as a defect.

THEN SCORE against this rubric:
- Hard gates (failing either -> score 0): correctness (no factual errors; every
  specific claim accurate and backed by a named verifiable source; quantitative
  claims trace to a primary source, not an aggregator; a claim that failed
  verification fails correctness); evidence (every non-trivial claim has a
  specific, named, non-marketing source, AND the source is a clickable full
  https:// URL, not a bare domain or page slug. A fact cited only as
  "cohere.com/pricing" fails; "https://cohere.com/pricing" passes. One or two
  minor shortened sources do not sink the file, but if the direction's
  decision-relevant facts are cited by bare domain rather than full URL, fail
  evidence: a fact the reader cannot click to verify is not a sourced fact).
- Soft gates (+1 each): technical_specificity (concrete numbers, dates, versions,
  named entities with their qualifiers); source_quality (primary over secondary;
  full URLs; subject's own materials tagged as claims, not laundered); coverage
  (the answerable questions pulled, gaps named honestly in Couldn't-find);
  grouping (related facts under sub-topic headings; facts that matter most tagged
  [decision-changing]); collection_discipline (collects without interpreting; no
  conclusions or arguments; contrary evidence recorded plainly). Plus any
  domain-specific gate the goal warrants.
Score = 0 if any hard gate fails, else the count of soft gates passed. Re-derive
the score from the per-gate verdicts.

Return the structured verdict: dirId (${f.dirId}), stance (${f.stance}), score,
failed (true if a hard gate failed), and one gate entry per gate (gate name,
pass/fail, one-line reason naming the specific claim).`
}

function synthPrompt(cfg, round, scoredFiles, roadmap) {
  const passing = scoredFiles.filter((s) => s.score > 0)
  const fileList = passing.map((s) => `- ${s.findingsFile} (${s.dirId}, ${s.stance}, score ${s.score})`).join('\n')
  const dirList = (roadmap?.dirs || [])
    .filter((d) => d.status !== 'killed')
    .map((d) => `- ${d.id}: ${d.name}`).join('\n')
  return `You fold one round's verified findings into the deliverable. You write
exactly TWO files — synthesis.md and evidence.md — and nothing else. Do NOT
write, read, or curate roadmap.md; the workflow owns it. Do NOT
fetch any sources; every claim here was already verified. This is writing only.

The findings files are FACTS ONLY: the workers collect, source, and group
evidence; they do not interpret it. You are the ONLY place interpretation
happens. Every conclusion, every weighing of one reading against another, every
"what this means for the reader" is yours to make, from the full pool of verified
facts across all the findings files (not from any single worker's slice). Read
the facts, then interpret them.

Research goal: ${cfg.goal}
Audience for the final document: ${cfg.audience}

Passing findings files to fold in (read them fully):
${fileList || '(none passed this round)'}

Existing deliverable to rewrite in place (read first, then rewrite):
- ${cfg.workingDir}/synthesis.md
- ${cfg.workingDir}/evidence.md

WORK IN THIS ORDER so you never run out of turns before returning: (1) read the
findings files and the two existing deliverable files, (2) write evidence.md,
(3) write synthesis.md, (4) do the Phase D pass, (5) return the structured
result. Step 5 is your LAST action and you MUST reach it — do not keep polishing
a deliverable that is already complete and self-consistent.

- evidence.md: exhaustive citation catalog, one line per cited fact, no
  interpretation, organized by direction/topic, hard cap ~25,000 characters,
  consolidate as you approach it. Every entry ends with the FULL https:// URL of
  the page that supports it, copied verbatim from the findings file, so the reader
  can click straight through to verify. Never shorten a URL to a bare domain
  (write https://cohere.com/blog/x, not cohere.com/blog/x). If a findings file
  gives only a bare domain for a decision-relevant fact, keep the fact but mark
  its source "(domain only, no exact URL)" so the gap is visible, not hidden.
- synthesis.md: the deliverable a human reads. Orient the reader in 2-3
  sentences (what the topic is, why they are reading this, what it covers). No
  process exhaust — never mention rounds, workers, judge, scorer, or stances. No
  self-qualification ("comprehensive"/"rigorous" banned). Define acronyms on
  first use. Plain English, real subjects, normal word order, nothing for effect.
  Observation vs inference: state cited facts plainly; for each inference name the
  evidence, a confidence level, and an alternative reading. Calibrate to evidence,
  do not manufacture balance. Lead with the most decision-relevant finding. Target
  ~2000-2500 words, soft cap. A claim that failed verification does not enter.

PHASE D — after writing synthesis.md, read it whole and check FIVE things:
recency (is each fact still current), internal consistency (no claim contradicts
another — fix in text where you can), material omissions / reachable facts
wrongly deferred (a label like estimate/unverified/data-room-only that a quick
public lookup could pin), over-narrow framing (a conclusion stronger than the
evidence, or a qualifier that buries a near-match), and THE SPINE TEST (the most
important): name the single claim the document's central conclusion rests on; is
it a verified fact or an inference chain? If the conclusion stands on an
unverified inference, that is a spine flag, however complete coverage looks; also
flag the spine if no worker this run attacked the central claim itself and only
peripheral directions were investigated. Fix what you can in prose. For each
UNRESOLVED flag, do not leave it as prose alone — return it in phaseDFlags
(kind one of: recency, contradiction, reachable_fact, omission, spine) with the
specific direction that would close it (closesWith: name + note, plus reopenId if
an existing direction should be re-opened).

Existing research directions (id: name). When you propose a child direction in
newDirections or a closesWith, set its \`parent\` to the EXACT \`d-\` id from this
list that it deepens (copy the id verbatim, not the name); use the empty string
only for a genuinely new top-level direction. Linking children to a real parent
id is what grows the research tree:
${dirList || '(none yet)'}

Return the structured result as your final action: synthesisFile, evidenceFile,
wordCount (of synthesis.md), newDirections (genuinely new threads — name + note +
parent id each), and phaseDFlags (empty if the deliverable is complete and self-consistent).`
}

// The script can't write files (sandbox), so this hands an agent the exact bytes
// to write — no judgment, pure I/O. Keeps state.md / roadmap.md / log.md current
// on disk for legibility and cross-session resume.
function stateMarkdown(cfg, round, atCap) {
  return ['# State', `goal: ${cfg.goal}`, `audience: ${cfg.audience}`,
    `working_dir: ${cfg.workingDir}`, `round: ${round}`, `round_cap: ${cfg.roundCap}`,
    `worker_count: ${cfg.workerCount}`,
    `converged: ${atCap}`, ''].join('\n') // "converged" here means "loop finished" (hit the cap)
}
function logLine(round, scored, synth) {
  const scores = scored.map((s) => `${s.dirId}/${s.stance}=${s.score}${s.failed ? ' (FAIL)' : ''}`).join(', ')
  const flags = (synth.phaseDFlags || []).map((f) => `${f.kind}: ${f.description}`).join('; ') || 'none'
  return `## Round ${round}\nscores: ${scores}\nsynthesis: ${synth.wordCount} words\nphase-D flags: ${flags}\n`
}
function flushPrompt(cfg, round, atCap, roadmap, scored, synth) {
  const state = stateMarkdown(cfg, round, atCap)
  const rm = roadmapToMarkdown(roadmap)
  const line = logLine(round, scored, synth)
  return `Use the Write tool to write three files exactly as given — no edits, no commentary, pure I/O. Create each file if it does not exist; replace its contents if it does. Then return the single word "flushed".

1. WRITE ${cfg.workingDir}/state.md (create or replace) with exactly:
${state}

2. WRITE ${cfg.workingDir}/roadmap.md (create or replace) with exactly:
${rm}

3. APPEND to ${cfg.workingDir}/log.md this block (Read the file if it exists, then Write its existing contents followed by this block; if it does not exist or is empty, Write "# Research log\n\n" then this block):
${line}`
}

// =============================================================================
// THE ROUND LOOP
// =============================================================================

let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch (e) { throw new Error('deep-research-loop: args is a string that is not valid JSON: ' + e.message) } }
if (!cfg || !cfg.goal || !cfg.workingDir) {
  throw new Error('deep-research-loop requires args: { goal, audience, workingDir, roundCap, workerCount, directions } — received: ' + JSON.stringify(cfg))
}
cfg.roundCap = cfg.roundCap || 5
cfg.workerCount = cfg.workerCount || 4
// Agent types. The worker is the registered custom agent (its protocol is long
// and lives in the agent definition). The scorer and synthesizer carry their
// full instructions in the prompt, so they run on general-purpose by default —
// this avoids depending on the custom agents being registered in the current
// session. Override any of these via cfg if you have the custom agents installed.
const NS = cfg.agentPrefix === undefined ? 'deep-research:' : cfg.agentPrefix
const WORKER = cfg.workerAgent || 'general-purpose'
const SCORER = cfg.scorerAgent || 'general-purpose'
const SYNTHESIZER = cfg.synthesizerAgent || 'general-purpose'
// Optional per-run model overrides. When set, force the model at the agent()
// call regardless of the agent definition's frontmatter, without editing or
// reinstalling the plugin.
// FINDING (tested 2026-06): workerModel:'haiku' fails. On an identical
// well-sourced topic, Sonnet workers scored [6,0,0,0] round 1 while Haiku scored
// [0,0,0,0] (all hard-failed verification, empty 158-word deliverable), and
// Haiku's input tokens were ~the same as Sonnet's (cost is fetched-page volume,
// not the model), so the failures would re-run and cost MORE. Keep workers on
// Sonnet. This override stays for deliberate per-run tuning, not as a default.
// Default workers to Sonnet (right tier for fact-collection; Haiku tested worse,
// see finding above). Override per-run with cfg.workerModel.
const workerOpts = { model: cfg.workerModel || 'sonnet' }

const roadmap = loadRoadmap(cfg.directions || [])
const dirName = (id) => (findDir(roadmap, id) || {}).name || id
const dirNote = (id) => (findDir(roadmap, id) || {}).note || ''

let round = 0
const summary = []

// The round cap is the ONLY stop (1.6+ tree model). No convergence exit.
while (round < cfg.roundCap) {
  round++
  log(`Round ${round}/${cfg.roundCap} — assigning workers`)

  const assignments = assignWorkers(roadmap, cfg.workerCount)
  if (assignments.length === 0) { log('No open stances to assign; stopping early.'); break }
  log(`Round ${round}: spawning ${assignments.length} workers`)

  // ---- RESEARCH: parallel fan-out ----
  const findings = (await parallel(assignments.map((a) => () =>
    agent(workerPrompt(cfg, a, round, dirName(a.dirId), dirNote(a.dirId)), {
      label: `research:${a.dirId}:${a.stance}`, phase: 'Research',
      agentType: WORKER, schema: FINDINGS_SCHEMA, ...workerOpts,
    }).then((r) => ({ ...a, ...r }))
  ))).filter(Boolean)

  // ---- SCORE: parallel per file (the monolithic judge's Phase A, split) ----
  const scored = (await parallel(findings.filter((f) => f.wroteFile !== false).map((f) => () =>
    agent(scorerPrompt(cfg, f, dirName(f.dirId)), {
      label: `score:${f.dirId}:${f.stance}`, phase: 'Score',
      agentType: SCORER, schema: SCORE_SCHEMA,
    }).then((s) => ({ ...f, ...s }))
  ))).filter(Boolean)

  applyScores(roadmap, scored)

  // ---- SYNTHESIZE: one writer, returns metadata + Phase-D flags as data ----
  const synth = await agent(synthPrompt(cfg, round, scored, roadmap), {
    label: `synthesize:round-${round}`, phase: 'Synthesize',
    agentType: SYNTHESIZER, schema: SYNTH_SCHEMA,
  })

  // ---- CURATE: the judge's proposed directions BRANCH the tree (parented as
  // children, depth+1). Phase-D flags become directions too. No convergence gate;
  // the run keeps exploring until the round cap. Dedup by name avoids re-adding
  // the same gap across rounds.
  const before = roadmap.dirs.length
  for (const nd of synth.newDirections || []) addOrReopenDirection(roadmap, nd)
  for (const flag of synth.phaseDFlags || []) {
    const c = flag.closesWith
    addOrReopenDirection(roadmap, { id: c.reopenId, name: c.name, note: c.note }, Boolean(c.reopenId))
  }
  const added = roadmap.dirs.length - before
  const atCap = shouldStop(round, cfg.roundCap)

  // ---- FLUSH: write state.md / roadmap.md / log.md to disk for legibility +
  // cross-session resume. The sandbox can't write files, so a tiny agent does it.
  // Must be a WRITER agent — the scorer is read-only (no Write tool).
  await agent(flushPrompt(cfg, round, atCap, roadmap, scored, synth), {
    label: `flush:round-${round}`, phase: 'Synthesize', agentType: cfg.flushAgent || 'general-purpose',
  }).catch(() => log(`Round ${round}: state flush failed (non-fatal)`))

  summary.push({ round, workers: assignments.length, scores: scored.map((s) => s.score), wordCount: synth.wordCount, newDirections: added })
  log(`Round ${round} done — ${added} new directions added to the tree`)
}

return {
  finished: true, rounds: round, workingDir: cfg.workingDir,
  roadmap: roadmapToMarkdown(roadmap),
  summary,
}
