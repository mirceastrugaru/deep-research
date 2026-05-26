---
name: deep-research
description: Multi-agent iterative research. Use when the user has a research goal — a question to answer, a topic to investigate, a due-diligence subject — and wants a thorough, sourced, audience-targeted document. Runs an autonomous loop of parallel research workers and a judge.
---

# Deep Research

You run a multi-agent research loop from THIS main session. You do not do the research yourself — you orchestrate. Each round you spawn several research workers (via the Agent tool, all in one message so they run in parallel — see Step 3), then one judge, then check the round cap. The deliverable is a readable, sourced document for a stated audience.

## Hard rules

- You run in the MAIN session. Never fork. You must be able to spawn subagents — a forked skill cannot.
- Research workers run in the FOREGROUND. Background subagents auto-deny permission prompts, breaking WebFetch/WebSearch.
- Subagents start with FRESH context. They see only their spawn prompt. Put every specific (goal, direction, stance, absolute paths) into the prompt.
- Subagents return a one-line status, not data. Every subagent writes its own output file. You and the judge read files — never parse a subagent's return text.
- All state is plain Markdown in the working directory. No JSON.
- After intake, the loop runs autonomously. Intake is the only human checkpoint — do not pause for approval mid-loop.

## Step 0 — Resume check

Before intake, check whether a run is already in progress. If the working directory is known or the user names one, read `state.md`. `round: N` means round N has STARTED (not that it finished) — `state.md` is set to the round number when that round begins, so the round number and the `findings/round-N/` directory never drift apart. Let N be `state.md`'s `round` and scan:

- `findings/round-N/` has fewer NON-EMPTY `agent-K.md` findings files than the worker count in `state.md` → round N's research is incomplete. Re-spawn the missing workers (each overwrites its own file — idempotent), then continue from the judge step. Count only non-empty `agent-K.md` files; ignore `agent-K.scratch.md` working files and treat an empty or stub `agent-K.md` as missing — re-spawn that worker.
- `findings/round-N/` is complete but `log.md` has no judge entry for round N → re-spawn the judge for round N.
- `findings/round-N/` is complete and round N is judged → round N is finished; start round N+1.

If no `state.md` exists anywhere relevant, this is a fresh run — go to intake. Re-invoking the skill NEVER restarts from scratch.

## Step 1 — Intake

Ask the user how deep the intake should be, and branch:

- **None** — the user has given a complete brief (goal, audience, sources). Derive the starting directions and begin immediately.
- **Light** — ask at most ONE clarifying question if the goal is genuinely ambiguous. Then propose the starting directions (3-6 broad ones) and the audience, and wait for ONE round of user edits/approval. Then run unattended.
- **Full** — work with the user interactively to scope goal, audience, sources, and starting directions before the loop.

By the end of intake you must have: the **working directory**, the **audience** for the final document, the **round cap** (default 5), the **worker count** (default 4, even, minimum 2), and the **starting directions** (3-6 broad ones).

## Step 2 — Initialize the working directory

Create the working directory and these files:

- `state.md` — see format below.
- `roadmap.md` — the starting directions, each with a fresh ID.
- `ledger.md` — empty per-direction history (headers only).
- `evidence.md`, `synthesis.md` — empty (the judge fills them).
- `log.md` — empty.
- `findings/` — empty; `sources/` if the user provided source files (read-only).

### state.md format

```
# State
goal: <one line>
audience: <one line>
working_dir: <absolute path>
round: 0
round_cap: 5
worker_count: 4
rounds_without_new_directions: 0
converged: false
```

### roadmap.md format

```
# Roadmap

## d-a1b2c3 — <direction name>
status: open            # open | covered | saturated | closed
parent: -               # parent direction ID, or - for a seed direction
depth: 0                # 0 for a seed/root; parent's depth + 1 for a child
coverage: supportive=no adversarial=no passing=no
note: <one line — why this matters / current state>

## d-d4e5f6 — <direction name>
...
```

Each stance in the `coverage:` line is `no` (not yet investigated), `yes` (investigated and the file passed), or `FAILED_NEEDS_RERUN` (a worker investigated it but the judge scored that file 0, so the output was discarded — the stance still needs a clean run). `passing=` is `yes` once at least one stance produced a score > 0 file.

Direction IDs are `d-` + 6 hex chars, stable for the life of the run. Seed directions get fresh IDs at init.

### ledger.md format

```
# Ledger

## d-a1b2c3 — <direction name>
- round 1, agent-1, supportive — score 4 — findings/round-1/agent-1.md
- round 1, agent-3, adversarial — score 0 (hard gate: evidence) — findings/round-1/agent-3.md
```

## Step 3 — The round loop

Each iteration is one round. Before starting a round, check the stop condition in Step 4 — if `round` has reached `round_cap`, do not start another round; go to Step 5 (final brief). Otherwise run the round:

1. **Set the round number.** This round's number is `state.md`'s `round` + 1 (it is 1 for the first round after init, which starts at `round: 0`). If that number would exceed `round_cap`, do not start the round — stop and go to Step 5. Otherwise write the number to `round` in `state.md` NOW, before spawning anything. Every `findings/round-<N>/...` path this round uses this number. Setting it up front is what keeps `state.md` and the `findings/` directories in sync.
2. **Read** `roadmap.md` and `ledger.md`.
3. **Assign directions.** Coverage-driven. A stance is settled only if its `coverage:` value is `yes`; `no` means unstarted and `FAILED_NEEDS_RERUN` means a discarded hard-gate failure. Assign in this priority order, highest first:
   1. **`FAILED_NEEDS_RERUN` stances** — a worker investigated this stance but the judge discarded the file (score 0). It is a known hole in a direction already judged worth investigating. Re-run it before any unstarted work.
   2. **Unstarted stances** (`no`) on directions not yet investigated.
   3. **Single-stance directions** — one stance settled, the other unstarted.
   4. **Deepen the tree** — child directions the judge spawned from strong findings (each `parent:` set, `depth:` > 0). These carry the tree downward; rank them by the judge's expected-value order, biased toward shallower depth first so the tree widens before any one branch runs deep.
   5. **Saturated / closed directions** (covered with no pending children, or `closed: dead-end`) — lowest; re-touch only if nothing above remains. The loop runs to the round cap, so when higher-priority work is exhausted, prefer pulling in the judge's next-round candidate children over re-confirming a saturated node.
   - A direction is **covered** once BOTH stances are `yes`. A `FAILED_NEEDS_RERUN` stance does NOT count toward covered — the direction stays open until that stance is re-run and passes.
   - Assign this round's workers to the highest-priority items. Split stances evenly: half supportive, half adversarial. Multiple workers may share a direction with opposite stances. When the round's worker count exceeds the priority-1 and priority-2 items, fill remaining slots down the order.
4. **Spawn ALL research workers for the round in ONE message** — one `Agent` call per worker, all in the same message, `subagent_type: research-worker`, foreground. The workers are independent (each owns its own direction, stance, and findings-file path), so the harness runs them in parallel. Use the spawn-prompt template below; the spawn prompt must state that the worker MUST write the findings file before returning (the file on disk is the only deliverable; a status line without a file is a failed run). The file-existence check in step 5 catches any worker whose file did not land — re-spawn just that worker.
5. **Verify every findings file exists and is non-empty** before the judge. After all workers for the round have run, list `findings/round-<N>/` and confirm one non-empty `agent-K.md` per worker. For any that is missing or empty, re-spawn that worker (it overwrites its own path — idempotent). Only after every file is present, or a worker has genuinely failed twice, proceed. A worker's return text is NOT proof its file was written — check the file. Write a failure line to `log.md` for any worker that fails twice; never block the round on one genuinely-failed worker.
6. **Write this round's `log.md` line** (round number, workers spawned, any failures) BEFORE spawning the judge — so you and the judge never write `log.md` concurrently.
7. **Spawn ONE judge**, `subagent_type: research-judge`, foreground, with absolute paths to: this round's findings files, `evidence.md`, `synthesis.md`, `roadmap.md`, `ledger.md`, `log.md`, plus the goal and audience.
8. **Handle judge failure.** Findings files survive on disk. Retry the judge once. If it fails twice, STOP and report — do not continue with no synthesis.
9. **Update `state.md`** — set `rounds_without_new_directions` (reset to 0 if the judge added any direction, else +1). Do NOT touch `round` here — it was already set in step 1 of this round.
10. **Check convergence** (Step 4).

### Worker spawn-prompt template

Each spawn prompt is self-contained. Fill every `<...>`:

```
Research goal: <goal>
Audience for the final document: <audience>

Your direction: <d-XXXXXX — direction name and one-line description>
Your stance: <supportive | adversarial>

Write your findings file to: <absolute path>/findings/round-<N>/agent-<K>.md
Source files (read-only), if any: <absolute path>/sources/

Follow your agent protocol exactly: structured findings file, observations
separated from inferences, every observation sourced, contrary evidence
recorded honestly, EVIDENCE LIMIT lines where you hit a ceiling. Return one
line: the file you wrote and an observation count.
```

## Step 4 — Stop condition

**The round cap is the only stop.** Run a round every iteration until `round` reaches `round_cap`, then stop and go to Step 5. There is no early "converged" exit: the loop does NOT stop because coverage looks complete or because a round added no new directions. The run explores for the full budget of rounds the user set, then stops. To make a run shorter or longer, set `round_cap` at intake — that number IS the run length.

When the cap is reached, set `converged: true` in `state.md` (it marks "loop finished", not "topic exhausted") and proceed to the final brief.

Coverage state and the judge's Phase D flags still matter — they drive *what* each round works on (priority order in Step 3, what the judge re-runs and adds). They simply no longer stop the loop. A round whose directions are all covered does not idle: the judge must branch (see Step 3 / the judge protocol) so the next round has deeper directions to pursue. `rounds_without_new_directions` is still tracked for the log, but it no longer triggers a stop.

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

Then spawn ONE `deck-builder` subagent, `subagent_type: deck-builder`, foreground. The spawn prompt is self-contained — the subagent starts with fresh context. Fill every `<...>` with a literal absolute path:

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
- <working dir absolute path>/ledger.md
- <working dir absolute path>/log.md

Write the deck to: <working dir absolute path>/<deck file>

Follow your agent protocol exactly: fill the frozen deck-kit (do not edit its
design), build the deck from facts in those files, include the research-method
slide built from roadmap.md / ledger.md / log.md, end with dense citation
slides built from evidence.md, and self-check against the 11-item Deck Quality
Bar before returning. If you cannot read the kit file, STOP and
report it — do not design a deck of your own. Return one line: the file
written, the slide count, and QB-check confirmation.
```

The deck-builder does no research and no design — it fills a frozen kit with the finished deliverables, so every deck shares one visual language. For a deck variant (different density), spawn a fresh `deck-builder`; do not edit a deck in the main session.

## Step 7 — Optional written memo (PDF)

The deck (Step 6) is slides; the memo is a prose document — a plain-English, fully-cited writeup that an expert reader will trust, rendered to a clean PDF. Also never automatic. After delivering the brief, offer one: "I can also write this up as a cited memo (PDF) — say the word." A user may want the memo, the deck, both, or neither.

The memo design and the writing bar are fixed: the `memo-builder` agent fills a frozen kit (`${CLAUDE_PLUGIN_ROOT}/assets/memo-kit.html`) and renders the PDF with `${CLAUDE_PLUGIN_ROOT}/assets/make-pdf.mjs`. As in Step 6, resolve `${CLAUDE_PLUGIN_ROOT}` to its literal absolute path before spawning (run `echo "${CLAUDE_PLUGIN_ROOT}"`) and write literal paths into the spawn prompt — never pass the unexpanded variable.

Then spawn ONE `memo-builder` subagent, `subagent_type: memo-builder`, foreground. Self-contained spawn prompt, fill every `<...>` with a literal absolute path:

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
