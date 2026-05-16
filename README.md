# deep-research

A Claude Code plugin marketplace shipping one plugin: **deep-research** — a
multi-agent iterative research system that runs entirely through Claude Code's
native Agent tool. No Python, no API keys.

You give it a research goal. It runs an autonomous loop — each round spawns
parallel research workers (some building the case for a direction, some
against it), then a judge scores their work, verifies every quantitative
claim, folds the findings into accumulating documents, and decides what to
investigate next. The deliverable is a readable, sourced document for a stated
audience.

> **Status: 0.9.0 — freshly built, validating.** Functional and in active
> testing. The version moves to 1.0.0 once it has completed full runs
> end-to-end.

## Install

In Claude Code:

```
/plugin marketplace add mirceastrugaru/deep-research
/plugin install deep-research@deep-research
```

Then restart Claude Code. `deep-research@deep-research` is
`plugin-name@marketplace-name` — both are `deep-research`, so it reads
doubled; that is correct.

## Update

```
/plugin marketplace update deep-research
/plugin update deep-research
```

Then restart Claude Code.

## Use

```
/deep-research:deep-research
```

The skill asks how deep the intake should be (none / light / full), settles
the goal, audience, working directory, round cap, and worker count, then runs
the loop autonomously. When it finishes, read `synthesis.md` and `brief.md` in
the working directory.

Debrief a finished run:

```
/deep-research:deep-research-review
```

## Repository layout

```
.claude-plugin/marketplace.json     marketplace manifest
plugins/deep-research/              the plugin
├── .claude-plugin/plugin.json
├── skills/
│   ├── deep-research/SKILL.md          orchestrating skill
│   └── deep-research-review/SKILL.md   debrief skill
└── agents/
    ├── research-worker.md              research subagent
    └── research-judge.md               scoring + synthesis subagent
```

Full plugin documentation is in `plugins/deep-research/README.md`. Scope is
qualitative research.
