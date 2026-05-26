# deep-research

Multi-agent iterative research for Claude Code. Give it a goal; it runs an
autonomous loop of supportive and adversarial workers and a verifying judge,
and produces a sourced, audience-targeted document - then optionally a deck or
a cited memo (PDF). No Python, no API keys.

## Install / update

```
/plugin marketplace add mirceastrugaru/deep-research   # then: update
/plugin install deep-research@deep-research            # then: update
```

Restart Claude Code after installing or updating.

## Use

```
/deep-research:deep-research          run a research goal
/deep-research:deep-research-review   debrief a finished run
```
