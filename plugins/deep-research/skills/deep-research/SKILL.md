---
name: deep-research
description: Multi-agent iterative research. Use when the user has a research goal (a question to answer, a topic to investigate, a due-diligence subject) and wants a thorough, sourced, audience-targeted document. Runs an autonomous Workflow loop of parallel research workers, per-file scoring, and synthesis.
---

# Deep Research

You run a multi-agent research loop. You do not do the research yourself; you orchestrate. After intake you hand a config to a background Workflow that runs the whole loop: each round it runs several research workers in parallel, scores their findings, synthesizes the deliverable, then branches the direction tree, and the run stops at the round cap. The deliverable is a readable, sourced document for a stated audience.

## Hard rules

- Intake and the deck/memo builders run in THIS main session. The research loop runs in the Workflow (Step 3).
- Subagents start with FRESH context. They see only their spawn prompt. The workflow builds each prompt with every specific (goal, direction, stance, absolute paths) inside it.
- All state is plain Markdown in the working directory. No JSON.
- After intake, the loop runs autonomously. Intake is the only human checkpoint; do not pause for approval mid-loop.

## Step 0: Resume check

Before intake, check whether a run is already in progress. If the working directory is known or the user names one, read `state.md`. `round: N` is the last round the workflow recorded; the deliverable files reflect the work through that round.

- If a finished run's files are present (a `state.md` with `converged: true`, plus `synthesis.md`), there is nothing to re-run; go to Step 5 to deliver, or offer the deck/memo.
- If a run was interrupted (`state.md` shows a round below `round_cap`, or `synthesis.md` is empty), re-launch the workflow with the SAME config (rebuild it from `state.md`: goal, audience, working_dir, round_cap, worker_count, and the seed directions from `roadmap.md`). The workflow overwrites its own files idempotently, so a clean re-launch picks up the goal from where the deliverables stand.

If no `state.md` exists anywhere relevant, this is a fresh run; go to intake.

## Step 1 — Intake

Ask the user how deep the intake should be, and branch:

- **None** — the user has given a complete brief (goal, audience, sources). Derive the starting directions and begin immediately.
- **Light** — ask at most ONE clarifying question if the goal is genuinely ambiguous. Then propose the starting directions (3-6 broad ones) and the audience, and wait for ONE round of user edits/approval. Then run unattended.
- **Full** — work with the user interactively to scope goal, audience, sources, and starting directions before the loop.

By the end of intake you must have: the **working directory**, the **audience** for the final document, the **round cap** (default 5), the **worker count** (default 4, even, minimum 2), and the **starting directions** (3-6 broad ones).

## Step 2: Initialize the working directory

Create the working directory and these empty files, then hand the directory to the workflow in Step 3. The workflow writes and maintains `state.md`, `roadmap.md`, and `log.md` itself each round; you only create the empty deliverable files and the findings directory:

- `synthesis.md`, `evidence.md` empty (the synthesizer fills them).
- `log.md` empty.
- `findings/` empty. Add `sources/` (read-only) if the user provided source files; pass its path as `sourcesDir`.

The seed directions go into the config's `directions` array (Step 3), not a hand-written roadmap; the workflow builds `roadmap.md` from them.

### state.md format (the workflow writes this; for reference)

```
# State
goal: <one line>
audience: <one line>
working_dir: <absolute path>
round: <current round>
round_cap: 5
worker_count: 4
converged: <true once the round cap is reached, meaning "loop finished">
```

### roadmap.md format (the workflow writes this; for reference)

```
# Roadmap

## d-a1b2c3: <direction name>
status: open            # open | covered | saturated | closed | killed
parent: -               # parent direction ID, or - for a seed direction
depth: 0                # 0 for a seed/root; parent's depth + 1 for a child
coverage: supportive=no adversarial=no passing=no
note: <one line: why this matters / current state>
```

Each stance in the `coverage:` line is `no` (not yet investigated), `yes` (investigated and the file passed), or `FAILED_NEEDS_RERUN` (a worker investigated it but the scorer gave that file 0, so the output was discarded and the stance needs a clean run). `passing=` is `yes` once at least one stance produced a score above 0. Direction IDs are `d-` plus 6 hex chars, stable for the life of the run.

## Step 3: Run the round loop (the Workflow tool)

The round loop runs as a deterministic background workflow. You do NOT spawn workers or score findings yourself. You build a config from intake (Step 1) and hand it to the workflow script, which owns round numbering, worker assignment, scoring, synthesis, and tree-branching across every round, and writes every deliverable to disk.

1. **Resolve the script path.** Run `echo "${CLAUDE_PLUGIN_ROOT}/workflow/deep-research.workflow.js"` to get the literal absolute path. Environment variables do not expand inside tool arguments, so resolve it first.
2. **Call the Workflow tool** with `scriptPath` set to that path and `args` set to the config you built from intake:

   ```json
   {
     "goal": "<goal>",
     "audience": "<audience>",
     "workingDir": "<absolute working dir>",
     "roundCap": <round cap>,
     "workerCount": <worker count>,
     "directions": [ { "name": "<direction>", "note": "<one line>" } ],
     "sourcesDir": "<absolute sources dir, or omit if none>",
     "scorerAgent": "deep-research:research-scorer",
     "synthesizerAgent": "deep-research:research-synthesizer"
   }
   ```

   The working directory must already hold empty `synthesis.md`, `evidence.md`, `log.md` and a `findings/` directory (created in Step 2). `directions` is the seed list from intake; the workflow grows the tree from there. The two agent fields are optional: if you omit them, the workflow runs the scorer and synthesizer on `general-purpose`. Pass the named agents when they are installed.
3. **Tell the user how to watch it** (see "How the user can watch a run" below), then let it run. It runs in the background and notifies you when done. There is no per-round report from you: the workflow runs detached, so progress is visible only in the working-directory files, which is what you point the user at.
4. **When it returns**, read its result object `{ finished, rounds, workingDir, roadmap, summary }`. The deliverables are on disk in `workingDir`. Go to Step 5.

If the Workflow tool is not available in the session, ask the user to enable it (it needs an explicit opt-in), then run Step 3. The loop runs only through the workflow.

### How the user can watch a run (tell them this once, when the loop starts)

A run can take many minutes per round. So the user never thinks it has frozen, tell them at the start how to watch it. From another terminal, in the working directory, the user can check progress directly:
- `cat state.md` for the current round and the cap.
- `tail -n 40 log.md` for the per-round lines, worker scores, and Phase D notes as they appear.
- `ls findings/round-*/` for how many findings files exist this round (the workers writing as they finish).
- `grep -c '^## d-' roadmap.md` for how many directions the tree holds; re-run it across rounds and the number climbing is the tree growing.
The run is alive as long as `log.md` is gaining lines and new `findings/round-N/` files appear; if neither changes for a long time, a worker or the synthesizer has stalled.

## Step 4: Stop condition

The round cap is the only stop. The workflow runs exactly `round_cap` rounds, then stops. There is no early exit: the loop does NOT stop because coverage looks complete or because a round added no new directions. The run explores for the full budget of rounds the user set. To make a run shorter or longer, set `round_cap` at intake; that number IS the run length.

Coverage state and Phase D flags still matter: they drive *what* each round works on (the workflow's assignment priority, what it re-runs and which children it adds). They no longer stop the loop. A round whose directions are all covered does not idle; the synthesizer branches the tree so the next round has deeper directions to pursue.

## Step 5 — Final brief

After the loop ends, produce `brief.md` once: a ~800-1200 word version of `synthesis.md` targeted at the stated audience. Same quality bar as `synthesis.md` — orientation opening, no process exhaust, no self-qualification, plain English (real subjects, normal word order, nothing written for effect), calibrated. Pick the 4-6 most decision-relevant findings for that audience plus the open questions they would need answered next. Write it yourself; do not spawn a subagent for this.

Then deliver a clear closing message to the user. It must:
- Give a 2-3 sentence summary of what the research found.
- List the artifacts produced, each with its absolute path and a one-line description:
  - `synthesis.md` — the full sourced research document, the main deliverable.
  - `evidence.md` — the citation catalog: every claim with its source.
  - `brief.md` — the short (~800-1200 word) version targeted at the stated audience.
- End by offering the optional deck (see Step 6) and the optional written memo (see Step 7).

## Step 6 — Optional presentation deck

The research loop ENDS at Step 5. A deck is never automatic. After delivering the brief, offer one: "I can also build a presentation deck from this — say the word."

If the user wants one, ask ONE question — **density**: boardroom (~12-16 slides) or comprehensive (~20-28). The deck's visual design is fixed (it is a frozen kit the deck-builder fills), so format and style are not choices.

The deck design lives in a kit file bundled with this plugin at
`${CLAUDE_PLUGIN_ROOT}/assets/deck-kit.html`. The subagent's spawn prompt is
plain text — environment variables do NOT expand inside it. Before spawning,
YOU resolve `${CLAUDE_PLUGIN_ROOT}` to its literal absolute path (it is set in
your environment; e.g. run `echo "${CLAUDE_PLUGIN_ROOT}/assets/deck-kit.html"`)
and write that literal path into the spawn prompt. Never pass the unexpanded
`${CLAUDE_PLUGIN_ROOT}` string to the subagent — it cannot resolve it.

Then spawn ONE `deck-builder` subagent, `subagent_type: deck-builder`. The spawn prompt is self-contained; the subagent starts with fresh context. Fill every `<...>` with a literal absolute path:

```
Build a presentation deck from a finished deep-research run.

Audience for the deck: <audience — the deck-builder uses this to calibrate
but must never name it on a slide>
Density: <boardroom | comprehensive>

Frozen design kit (read it, fill its slides array, do NOT edit its design):
<resolved absolute path>/assets/deck-kit.html

Deliverable files to consume (read all fully):
- <working dir absolute path>/synthesis.md
- <working dir absolute path>/evidence.md
- <working dir absolute path>/brief.md
- <working dir absolute path>/roadmap.md
- <working dir absolute path>/log.md

Write the deck to: <working dir absolute path>/<deck file>

Follow your agent protocol exactly: fill the frozen deck-kit (do not edit its
design), build the deck from facts in those files, include the research-method
slide built from roadmap.md and log.md (per-direction history pivoted from
log.md's per-round scores), end with dense citation slides built from
evidence.md, and self-check against the 11-item Deck Quality Bar before
returning. If you cannot read the kit file, STOP and report it; do not design a
deck of your own. Return one line: the file written, the slide count, and
QB-check confirmation.
```

The deck-builder does no research and no design — it fills a frozen kit with the finished deliverables, so every deck shares one visual language. For a deck variant (different density), spawn a fresh `deck-builder`; do not edit a deck in the main session.

## Step 7 — Optional written memo (PDF)

The deck (Step 6) is slides; the memo is a prose document — a plain-English, fully-cited writeup that an expert reader will trust, rendered to a clean PDF. Also never automatic. After delivering the brief, offer one: "I can also write this up as a cited memo (PDF) — say the word." A user may want the memo, the deck, both, or neither.

The memo design and the writing bar are fixed: the `memo-builder` agent fills a frozen kit (`${CLAUDE_PLUGIN_ROOT}/assets/memo-kit.html`) and renders the PDF with `${CLAUDE_PLUGIN_ROOT}/assets/make-pdf.mjs`. As in Step 6, resolve `${CLAUDE_PLUGIN_ROOT}` to its literal absolute path before spawning (run `echo "${CLAUDE_PLUGIN_ROOT}"`) and write literal paths into the spawn prompt — never pass the unexpanded variable.

Then spawn ONE `memo-builder` subagent, `subagent_type: memo-builder`. Self-contained spawn prompt, fill every `<...>` with a literal absolute path:

```
Build a cited written memo (and its PDF) from a finished deep-research run.

Audience for the memo: <audience>

Frozen design kit (read it, fill the body and notes, do NOT edit its design):
<resolved absolute path>/assets/memo-kit.html
PDF build script:
<resolved absolute path>/assets/make-pdf.mjs

Deliverable files to consume (read all fully):
- <working dir absolute path>/synthesis.md
- <working dir absolute path>/evidence.md
- <working dir absolute path>/brief.md

Write the memo HTML to:     <working dir absolute path>/memo.html
Write the memo PDF to:      <working dir absolute path>/memo.pdf
Write the coverage ledger:  <working dir absolute path>/memo-coverage.md

Follow your agent protocol exactly: synthesis.md is the BINDING fact-set - re-voice
and compress it, do not re-select; carry every material synthesis point (evidence.md
is verify-only, not a source of extra points); fill the frozen memo-kit (do not edit
its design); every fact carries a numbered footnote and every inference is tagged INF
with its reasoning; verify every legal/regulatory/named-case citation against a primary
source (WebFetch) before citing; link public sources, cite internal/own-inference
plainly; write the MANDATORY memo-coverage.md ledger (every synthesis point CARRIED or
CUT-with-reason) and the memo-verification.md coherence table; run the writing-bar
self-check (plain English, no LLM filler, no em-dashes, no recycling the subject's own
materials as findings, no inventing precision you cannot estimate); render the PDF and
regenerate it after any edit. If you cannot read the kit file, STOP and report it.
Return one line: HTML + PDF + memo-coverage.md paths, section count, footnote count,
synthesis points CUT, self-check confirmation.
```

The memo-builder does no new research and no design — it may only WebFetch to verify a primary source before citing it. For a revision, spawn a fresh `memo-builder`; do not hand-edit the memo in the main session.
