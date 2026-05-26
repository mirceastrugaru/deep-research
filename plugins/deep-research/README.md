# deep-research

Multi-agent iterative research for Claude Code. Native Agent tool only - no
Python, no API keys. You give a goal; each round spawns supportive and
adversarial workers, a judge scores their work, verifies every number against
its source, and folds it into a sourced document. The loop stops when the
topic is covered. Optionally builds a presentation deck or a cited written
memo (PDF) from the result.

## Pack

```
skills/deep-research/         the orchestrating skill
skills/deep-research-review/  debrief a finished run
agents/research-worker.md     one direction, one stance, sourced findings
agents/research-judge.md      score + verify + synthesize + curate roadmap
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
