# deep-research

Multi-agent iterative research for Claude Code. No Python, no API keys. You give
a goal; the skill hands a config to a background Workflow that runs the loop. Each
round spawns supportive and adversarial workers in parallel, scores each findings
file against its sources, synthesizes the deliverable, and branches a tree of
research directions. The run explores for a fixed number of rounds (the round
cap), then stops. Optionally builds a presentation deck or a cited written memo
(PDF) from the result.

## Pack

```
skills/deep-research/         the orchestrating skill (intake, then runs the Workflow)
skills/deep-research-review/  debrief a finished run
workflow/                     the deterministic round-loop (Workflow script + tested core)
agents/research-worker.md     one direction, one stance, sourced findings
agents/research-scorer.md     verifies and scores one findings file (parallel)
agents/research-synthesizer.md folds findings into the deliverable, branches the tree
agents/deck-builder.md        optional deck (fills a frozen kit)
agents/memo-builder.md        optional cited memo, rendered to PDF
assets/  deck-kit.html, memo-kit.html (frozen designs), make-pdf.mjs
```

## Install

```
/plugin marketplace add mirceastrugaru/deep-research
/plugin install deep-research@deep-research
```

## Use

```
/deep-research:deep-research          run a research goal
/deep-research:deep-research-review   debrief a finished run
```

State is plain Markdown in the working directory; a run resumes where it left
off, never restarts. Workers and the deck/memo builders fill frozen kits and do
no design. Scope is qualitative research.
