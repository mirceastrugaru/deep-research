# deep-research

A Claude Code plugin: multi-agent iterative research that runs entirely through
Claude Code's native Agent tool. No Python, no API keys.

> **Status: 1.3.1.** Has completed full research runs end-to-end; deck-builder
> ships a frozen design kit.

You give it a research goal. It runs an autonomous loop — each round spawns
research workers (some building the case for a direction, some
against it), then a judge scores their work, verifies every quantitative
claim, folds the findings into accumulating documents, and decides what to
investigate next. The loop stops when the topic is adequately covered.

The deliverable is a readable, sourced document written for a stated audience.
After the loop, the plugin can optionally build a presentation deck from the
finished research.

## What's in the pack

```
deep-research/
├── .claude-plugin/plugin.json
├── skills/
│   ├── deep-research/SKILL.md          the orchestrating skill
│   └── deep-research-review/SKILL.md   debrief a finished run
├── agents/
│   ├── research-worker.md              research subagent
│   ├── research-judge.md               scoring + synthesis subagent
│   └── deck-builder.md                 optional deck subagent
└── assets/
    └── deck-kit.html                   frozen deck design the deck-builder fills
```

## Install

From a local copy:

```
claude --plugin-dir /path/to/deep-research
```

Or, if pushed to git:

```
/plugin install <git-url>
```

Installing the plugin makes everything available together: the two skills
(namespaced `/deep-research:deep-research` and
`/deep-research:deep-research-review`) and the three custom subagents.

## Use

```
/deep-research:deep-research
```

The skill asks how deep the intake should be (none / light / full), settles
the goal, audience, working directory, round cap, and worker count, then runs
the loop autonomously. When it finishes, read `synthesis.md` and `brief.md` in
the working directory.

To debrief a run:

```
/deep-research:deep-research-review
```

## How it works

- **Workers** investigate one direction each, with a supportive or adversarial
  stance. They do real web research, follow leads to primary sources, and
  write a structured findings file (observations separated from inferences,
  every observation sourced).
- **The judge** scores each findings file against a hard/soft-gate rubric,
  re-checks every quantitative claim against its source, detects
  context-stripping, then rewrites the deliverable documents and curates the
  roadmap of what to investigate next.
- **The deck-builder** is an optional third subagent. After the loop, on
  request, it consumes the finished `synthesis.md` / `evidence.md` /
  `brief.md` and fills a frozen design kit (`assets/deck-kit.html`) to produce
  a single-file presentation deck — graded against a 10-item quality bar.
  Every deck shares one visual language; the agent composes slides but does
  no design and no research.
- **State** is plain Markdown files in the working directory. The run is
  resumable — re-invoking the skill picks up where it left off, never restarts.

Scope is qualitative research.
