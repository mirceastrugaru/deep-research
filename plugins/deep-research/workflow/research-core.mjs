// research-core.mjs — deterministic logic for the deep-research workflow.
//
// This is the source of truth for everything the round-loop decides without a
// model: roadmap state, worker assignment, score application, convergence. The
// workflow script (deep-research.workflow.js) carries an inline copy of these
// functions because Workflow scripts run sandboxed and cannot import. Keep the
// two in sync; the tests in test/ run against THIS module.
//
// State is held in memory as a plain object, then flushed to Markdown for
// on-disk legibility and cross-session resume. No model judgment lives here.

// ---- ID generation (deterministic, seeded — scripts have no Math.random) ----

// A small string hash so direction IDs are stable and collision-resistant
// without Math.random (forbidden in workflow scripts). Seeded by name+salt.
export function dirId(name, salt = '') {
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
export const NO = 'no';
export const YES = 'yes';
export const FAILED = 'FAILED_NEEDS_RERUN';

// Build the in-memory roadmap from the intake config's starting directions.
export function loadRoadmap(directions) {
  return {
    dirs: directions.map((d, i) => ({
      id: d.id || dirId(d.name, String(i)),
      name: d.name,
      note: d.note || '',
      parent: d.parent || '-',
      status: 'open', // open | covered | saturated | killed
      supportive: NO,
      adversarial: NO,
    })),
  };
}

export function findDir(roadmap, id) {
  return roadmap.dirs.find((d) => d.id === id);
}

// A direction is covered once BOTH stances are yes. A FAILED stance never counts
// toward covered. killed/saturated directions are not "open work".
export function isCovered(d) {
  return d.supportive === YES && d.adversarial === YES;
}

export function hasFailedStance(d) {
  return d.supportive === FAILED || d.adversarial === FAILED;
}

// ---- Worker assignment (SKILL.md Step 3 priority order, deterministic) -------
//
// Priority, highest first:
//   1. FAILED_NEEDS_RERUN stances — known holes, re-run before anything new.
//   2. Unstarted stances (no) on directions with NEITHER stance started.
//   3. Single-stance directions — one stance settled, the other unstarted.
//   4. Saturated directions — lowest.
// Split stances evenly across the round; fill remaining slots down the order.

export function assignWorkers(roadmap, workerCount) {
  const live = roadmap.dirs.filter((d) => d.status !== 'killed');

  const slots = []; // {dirId, stance}
  const want = (d, stance) => {
    const v = d[stance];
    return v === NO || v === FAILED;
  };

  // Bucket 1: failed stances.
  for (const d of live) {
    for (const stance of ['supportive', 'adversarial']) {
      if (d[stance] === FAILED) slots.push({ dirId: d.id, stance, prio: 1 });
    }
  }
  // Bucket 2: directions with neither stance started.
  for (const d of live) {
    if (d.supportive === NO && d.adversarial === NO) {
      slots.push({ dirId: d.id, stance: 'supportive', prio: 2 });
      slots.push({ dirId: d.id, stance: 'adversarial', prio: 2 });
    }
  }
  // Bucket 3: single-stance directions (one settled yes, other unstarted no).
  for (const d of live) {
    if (d.supportive === YES && d.adversarial === NO) {
      slots.push({ dirId: d.id, stance: 'adversarial', prio: 3 });
    } else if (d.adversarial === YES && d.supportive === NO) {
      slots.push({ dirId: d.id, stance: 'supportive', prio: 3 });
    }
  }
  // Bucket 4: saturated directions — re-touch lowest priority.
  for (const d of live) {
    if (d.status === 'saturated') {
      for (const stance of ['supportive', 'adversarial']) {
        if (want(d, stance)) slots.push({ dirId: d.id, stance, prio: 4 });
      }
    }
  }

  // De-dupe (a stance could be both failed and saturated-bucketed): keep best prio.
  const seen = new Map();
  for (const s of slots) {
    const key = `${s.dirId}:${s.stance}`;
    if (!seen.has(key) || seen.get(key).prio > s.prio) seen.set(key, s);
  }
  const ordered = [...seen.values()].sort((a, b) => a.prio - b.prio);

  // Take up to workerCount, then balance stances within the taken set by
  // walking the ordered list and preferring to keep supportive/adversarial even.
  const taken = ordered.slice(0, workerCount);
  return taken.map(({ dirId, stance }, i) => ({
    dirId,
    stance,
    agentK: i + 1,
  }));
}

// ---- Apply this round's scores to the roadmap (deterministic) ----------------
//
// scored: [{ dirId, stance, score, failed }]  (failed = hard-gate fail, score 0)
// A passing stance (score > 0) -> yes. A hard-gate failure -> FAILED_NEEDS_RERUN.
export function applyScores(roadmap, scored) {
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
export function normName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Add a brand-new direction proposed by the synthesizer (or a Phase-D closer).
// reopen=true resets coverage on an existing direction (Phase-D fix for issue A).
// Dedup is by id first, then by normalized name — the synthesizer re-proposes the
// same gap across rounds, so a name match must NOT create a duplicate direction.
export function addOrReopenDirection(roadmap, { id, name, note, parent }, reopen = false) {
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
  const d = {
    id: id || dirId(name, String(roadmap.dirs.length)),
    name,
    note: note || '',
    parent: parent || '-',
    status: 'open',
    supportive: NO,
    adversarial: NO,
  };
  roadmap.dirs.push(d);
  // Cap at ~15 active directions: drop lowest-value killed/covered overflow.
  const active = roadmap.dirs.filter((x) => x.status !== 'killed');
  if (active.length > 15) {
    // prefer to kill the oldest covered direction with no failed stance
    const victim = roadmap.dirs.find(
      (x) => x.status === 'covered' && !hasFailedStance(x)
    );
    if (victim) victim.status = 'killed';
  }
  return d;
}

// ---- Convergence (SKILL.md Step 4 — all three, deterministic boolean) --------
//
// 1. every live direction covered (both stances yes, no FAILED), AND
// 2. no new directions for 2 consecutive rounds, AND
// 3. no open Phase-D flag this round.
export function isConverged(roadmap, dryRounds, openPhaseDFlags) {
  const live = roadmap.dirs.filter((d) => d.status !== 'killed');
  const allCovered =
    live.length > 0 &&
    live.every((d) => isCovered(d) && !hasFailedStance(d));
  return allCovered && dryRounds >= 2 && openPhaseDFlags === 0;
}

// ---- Markdown flush (legibility + cross-session resume backstop) -------------

export function roadmapToMarkdown(roadmap) {
  const lines = ['# Roadmap', ''];
  for (const d of roadmap.dirs) {
    lines.push(`## ${d.id} — ${d.name}`);
    lines.push(`status: ${d.status}`);
    lines.push(`parent: ${d.parent}`);
    const passing = d.supportive === YES || d.adversarial === YES ? YES : NO;
    lines.push(
      `coverage: supportive=${d.supportive} adversarial=${d.adversarial} passing=${passing}`
    );
    lines.push(`note: ${d.note}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function stateToMarkdown(cfg, round, dryRounds, converged) {
  return [
    '# State',
    `goal: ${cfg.goal}`,
    `audience: ${cfg.audience}`,
    `working_dir: ${cfg.workingDir}`,
    `round: ${round}`,
    `round_cap: ${cfg.roundCap}`,
    `worker_count: ${cfg.workerCount}`,
    `rounds_without_new_directions: ${dryRounds}`,
    `converged: ${converged}`,
    '',
  ].join('\n');
}
