# deep-research workflow rebuild

A rebuild of the deep-research round-loop on Claude Code's Workflow capability.
The conversational intake, the deck-builder, and the review skill stay where
they are; only the autonomous research loop (SKILL.md Steps 3-4) moves into a
deterministic background workflow.

## Why

In the skill version, the main-session model re-derives loop state from Markdown
every turn: round number, coverage, "did the judge add a direction," convergence.
Two correctness issues came from that (a resume worker-count miscount and a
Phase-D flag that pointed at no concrete direction). Moving the loop into a
deterministic script makes that state real data the script holds and decides on,
and both issues disappear by construction.

## Layout

```
workflow/
├── deep-research.workflow.js   the Workflow script (round-loop orchestration)
├── research-core.mjs           deterministic logic — source of truth, tested
├── schemas.mjs                 JSON Schemas for agent() structured returns
└── test/
    ├── research-core.test.mjs  unit tests for the deterministic logic
    └── inline-parity.test.mjs  guards the workflow's inline copy against drift
```

The workflow script runs sandboxed and cannot `import`, so it carries a verbatim
inline copy of `research-core.mjs`. `test/inline-parity.test.mjs` slices that
copy out of the script and proves it behaves identically to the tested module.
When you change the logic, change `research-core.mjs`, copy it into the script's
inline block, and run the tests.

## Run the tests

```
cd plugins/deep-research/workflow
node --test
```

No dependencies, no API. The tests cover assignment priority, score application,
FAILED_NEEDS_RERUN handling, the three-part convergence check, the Phase-D
reopen, a full no-API loop simulation, and inline/module parity.

## Run the loop

Intake (conversational) produces a config object, then:

```
Workflow({
  scriptPath: ".../deep-research.workflow.js",
  args: {
    goal, audience, workingDir,        // required
    roundCap, workerCount,             // default 5, 4
    directions: [{ name, note }, ...], // 3-6 starting directions
    sourcesDir,                        // optional read-only sources
    agentPrefix,                       // default "deep-research:"
  },
})
```

The working directory must already contain empty `synthesis.md`, `evidence.md`,
`log.md` and a `findings/` directory. The workflow returns `{ converged, rounds,
workingDir, roadmap, summary }`; the main session then writes `brief.md` and
offers the deck.

## What stays in the main session

Intake (needs interaction), the final brief, the deck-builder, and the review
skill. The workflow is only the unattended loop.
