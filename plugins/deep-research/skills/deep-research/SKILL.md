---
name: deep-research
description: Multi-agent iterative research. Use when the user has a research goal — a question to answer, a topic to investigate, a due-diligence subject — and wants a thorough, sourced, audience-targeted document. Runs an autonomous loop of parallel research workers and a judge.
---

# Deep Research

You run a multi-agent research loop from THIS main session. You do not do the research yourself — you orchestrate. Each round you spawn parallel research workers (via the Agent tool), then one judge, then check convergence. The deliverable is a readable, sourced document for a stated audience.

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
status: open            # open | covered | saturated | killed
parent: -               # parent direction ID, or - for a seed direction
coverage: supportive=no adversarial=no passing=no
note: <one line — why this matters / current state>

## d-d4e5f6 — <direction name>
...
```

Direction IDs are `d-` + 6 hex chars, stable for the life of the run. Seed directions get fresh IDs at init.

### ledger.md format

```
# Ledger

## d-a1b2c3 — <direction name>
- round 1, agent-1, supportive — score 4 — findings/round-1/agent-1.md
- round 1, agent-3, adversarial — score 0 (hard gate: evidence) — findings/round-1/agent-3.md
```

## Step 3 — The round loop

Each iteration is one round. Before starting a round, check the two stop conditions in §4 Convergence — if either holds, do not start another round; go to Step 5 (final brief). Otherwise run the round:

1. **Set the round number.** This round's number is `state.md`'s `round` + 1 (it is 1 for the first round after init, which starts at `round: 0`). If that number would exceed `round_cap`, do not start the round — stop and go to Step 5. Otherwise write the number to `round` in `state.md` NOW, before spawning anything. Every `findings/round-<N>/...` path this round uses this number. Setting it up front is what keeps `state.md` and the `findings/` directories in sync.
2. **Read** `roadmap.md` and `ledger.md`.
3. **Assign directions.** Coverage-driven:
   - A direction not yet investigated gets priority.
   - A direction is **covered** once BOTH a supportive and an adversarial worker have investigated it AND at least one produced a passing-score (score > 0) findings file.
   - A covered direction that spawned no new sub-directions is **saturated** — deprioritize it.
   - Assign this round's workers to the highest-priority under-covered directions. Split stances evenly: half supportive, half adversarial. Multiple workers may share a direction with opposite stances.
4. **Spawn all research workers in parallel** — multiple Agent calls in a SINGLE message, `subagent_type: research-worker`, foreground. Use the spawn-prompt template below.
5. **Handle worker failure.** If a worker returns nothing, or its findings file is missing/empty, proceed with the remaining workers. Write a failure line to `log.md`. Never block the round on one failed worker.
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

## Step 4 — Convergence

Stop when BOTH:
- every direction in `roadmap.md` is covered by both stances with at least one passing-score findings file, AND
- no new directions were proposed for 2 consecutive rounds (`rounds_without_new_directions >= 2`).

Or stop at the round cap. Whichever comes first. Set `converged: true` in `state.md`.

## Step 5 — Final brief

After the loop ends, produce `brief.md` once: a ~800-1200 word version of `synthesis.md` targeted at the stated audience. Same quality bar as `synthesis.md` — orientation opening, no process exhaust, no self-qualification, plain language, calibrated. Pick the 4-6 most decision-relevant findings for that audience plus the open questions they would need answered next. Write it yourself; do not spawn a subagent for this.

Then tell the user where `synthesis.md`, `evidence.md`, and `brief.md` are, and give a 2-3 sentence summary of what the research found.
