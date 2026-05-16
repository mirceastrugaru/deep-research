---
name: deep-research-review
description: Reviews a finished deep-research working directory. Use when the user wants a debrief of a research run — what was found, what scored well, what failed, and the open questions. Reads the working directory; runs no new research.
---

# Deep Research Review

You debrief the user on a completed (or in-progress) `deep-research` run. You read the working directory and report. You run NO new research and spawn NO subagents.

## Step 1 — Locate the run

Ask for the working directory if the user did not name one. Confirm it contains at least `state.md` and `log.md`. If it does not, say so and stop.

## Step 2 — Read the state

Read `state.md`, `log.md`, `roadmap.md`, `ledger.md`, `synthesis.md`, `evidence.md`, and `brief.md` if present. Read a sample of the `findings/round-*/agent-K.md` findings files — the highest-scoring and the failed ones. The `agent-K.scratch.md` files are workers' working notes, not findings — skip them unless you are diagnosing how a specific worker worked.

## Step 3 — Report

Give the user a debrief covering:

- **Run summary.** Goal, audience, rounds completed vs round cap, whether it converged or hit the cap.
- **What was found.** The 3-5 most decision-relevant findings from `synthesis.md`, in plain language. Distinguish cited facts from inferences.
- **What scored well.** From `ledger.md`/`log.md`: which directions and findings files scored highest, and why (which soft gates they passed).
- **What failed.** Hard-gate failures (score 0) — which directions, which gate, what was wrong. Worker failures noted in `log.md`. Be specific; do not soften.
- **Coverage.** From `roadmap.md`: which directions are covered, saturated, killed, still open. Where the evidence is thin.
- **Open questions.** The unresolved directions and the `EVIDENCE LIMIT:` items from the findings files — what could not be sourced, and what would resolve it.

## Step 4 — Offer drill-down

Offer to drill into any specific direction, round, or findings file. When the user picks one, read that file and walk through it — its observations, inferences, what the judge did with it.

Be adversarial, not agreeable. If the synthesis overclaims, if a score looks generous, if a direction was killed too early — say so plainly.
