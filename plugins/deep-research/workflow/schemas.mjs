// schemas.mjs — JSON Schemas the workflow passes to agent() so subagents return
// validated DATA, not a status line. This replaces the file-as-message-bus for
// control-flow data: the worker still writes its prose findings file to disk,
// but it ALSO returns the structured summary the script needs to make decisions.
//
// These are duplicated inline in the workflow script (sandbox can't import).

// Worker returns: confirmation it wrote its file, plus the new directions it
// spotted (the only worker output the loop needs to act on between rounds).
export const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['findingsFile', 'observationCount', 'newDirections'],
  properties: {
    findingsFile: { type: 'string', description: 'absolute path actually written' },
    observationCount: { type: 'integer', minimum: 0 },
    wroteFile: { type: 'boolean', description: 'true only if the file is on disk' },
    newDirections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'reason'],
        properties: {
          name: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

// Scorer returns one verdict per findings file (Phase A, now parallel per file).
export const SCORE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['dirId', 'stance', 'score', 'failed', 'gates'],
  properties: {
    dirId: { type: 'string' },
    stance: { type: 'string', enum: ['supportive', 'adversarial'] },
    score: { type: 'integer', minimum: 0 },
    failed: { type: 'boolean', description: 'true if a hard gate failed (score 0)' },
    gates: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gate', 'pass', 'reason'],
        properties: {
          gate: { type: 'string' },
          pass: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

// Synthesizer writes synthesis.md + evidence.md to disk and returns only the
// data the loop needs: word count, proposed new directions, and Phase-D flags
// (each with the direction that closes it — the issue-A fix made structured).
export const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['synthesisFile', 'evidenceFile', 'wordCount', 'newDirections', 'phaseDFlags'],
  properties: {
    synthesisFile: { type: 'string' },
    evidenceFile: { type: 'string' },
    wordCount: { type: 'integer', minimum: 0 },
    newDirections: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'note'],
        properties: {
          name: { type: 'string' },
          note: { type: 'string' },
          parent: { type: 'string' },
        },
      },
    },
    phaseDFlags: {
      type: 'array',
      description: 'unresolved completeness/consistency flags, each with its closer',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'description', 'closesWith'],
        properties: {
          kind: {
            type: 'string',
            enum: ['recency', 'contradiction', 'reachable_fact', 'omission', 'spine'],
          },
          description: { type: 'string' },
          closesWith: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'note'],
            description: 'the direction to open/re-open to close this flag',
            properties: {
              reopenId: { type: 'string', description: 'existing dir id to reopen, or omit to add new' },
              name: { type: 'string' },
              note: { type: 'string' },
            },
          },
        },
      },
    },
  },
};
