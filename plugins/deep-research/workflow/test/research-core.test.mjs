import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dirId,
  loadRoadmap,
  findDir,
  isCovered,
  hasFailedStance,
  assignWorkers,
  applyScores,
  addOrReopenDirection,
  normName,
  isConverged,
  roadmapToMarkdown,
  stateToMarkdown,
  NO,
  YES,
  FAILED,
} from '../research-core.mjs';

const seed = (names) =>
  loadRoadmap(names.map((n) => ({ name: n, note: `note ${n}` })));

// ---- ID generation -----------------------------------------------------------

test('dirId is deterministic, formatted d- + 6 hex, and salt-distinct', () => {
  assert.equal(dirId('Alpha', '0'), dirId('Alpha', '0'));
  assert.match(dirId('Alpha', '0'), /^d-[0-9a-f]{6}$/);
  assert.notEqual(dirId('Alpha', '0'), dirId('Alpha', '1'));
});

test('loadRoadmap gives every seed a unique id and open/no/no state', () => {
  const r = seed(['A', 'B', 'C']);
  const ids = r.dirs.map((d) => d.id);
  assert.equal(new Set(ids).size, 3);
  for (const d of r.dirs) {
    assert.equal(d.status, 'open');
    assert.equal(d.supportive, NO);
    assert.equal(d.adversarial, NO);
  }
});

// ---- coverage predicates -----------------------------------------------------

test('isCovered requires BOTH stances yes', () => {
  const r = seed(['A']);
  const d = r.dirs[0];
  assert.equal(isCovered(d), false);
  d.supportive = YES;
  assert.equal(isCovered(d), false);
  d.adversarial = YES;
  assert.equal(isCovered(d), true);
});

test('a FAILED stance is never covered even if the other is yes', () => {
  const r = seed(['A']);
  const d = r.dirs[0];
  d.supportive = YES;
  d.adversarial = FAILED;
  assert.equal(isCovered(d), false);
  assert.equal(hasFailedStance(d), true);
});

// ---- assignment priority (the heart of Step 3) -------------------------------

test('fresh roadmap assigns both stances of unstarted directions (prio 2)', () => {
  const r = seed(['A', 'B']);
  const a = assignWorkers(r, 4);
  assert.equal(a.length, 4);
  // two directions, each with supportive + adversarial
  const perDir = {};
  for (const s of a) (perDir[s.dirId] ||= []).push(s.stance);
  for (const id of Object.keys(perDir)) {
    assert.deepEqual(perDir[id].sort(), ['adversarial', 'supportive']);
  }
});

test('FAILED stance outranks unstarted directions', () => {
  const r = seed(['A', 'B']);
  // A.supportive failed earlier; B never started.
  r.dirs[0].supportive = FAILED;
  r.dirs[0].adversarial = YES;
  const a = assignWorkers(r, 1); // only one slot
  assert.equal(a.length, 1);
  assert.equal(a[0].dirId, r.dirs[0].id);
  assert.equal(a[0].stance, 'supportive'); // the failed one, not B
});

test('single-stance direction (prio 3) ranks below a brand-new one (prio 2)', () => {
  const r = seed(['A', 'B']);
  r.dirs[0].supportive = YES; // A needs only adversarial -> prio 3
  // B untouched -> prio 2 (two slots)
  const a = assignWorkers(r, 2);
  // both slots should go to B before A's single stance
  assert.ok(a.every((s) => s.dirId === r.dirs[1].id));
});

test('assignment never exceeds workerCount and gives sequential agentK', () => {
  const r = seed(['A', 'B', 'C', 'D']);
  const a = assignWorkers(r, 3);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((s) => s.agentK), [1, 2, 3]);
});

test('killed directions are never assigned', () => {
  const r = seed(['A', 'B']);
  r.dirs[0].status = 'killed';
  const a = assignWorkers(r, 4);
  assert.ok(a.every((s) => s.dirId === r.dirs[1].id));
});

// ---- applying scores ---------------------------------------------------------

test('a passing score sets the stance yes; a hard-gate failure sets FAILED', () => {
  const r = seed(['A']);
  const id = r.dirs[0].id;
  applyScores(r, [
    { dirId: id, stance: 'supportive', score: 4, failed: false },
    { dirId: id, stance: 'adversarial', score: 0, failed: true },
  ]);
  assert.equal(r.dirs[0].supportive, YES);
  assert.equal(r.dirs[0].adversarial, FAILED);
  assert.equal(r.dirs[0].status, 'open'); // failed stance keeps it open
});

test('both stances passing marks the direction covered', () => {
  const r = seed(['A']);
  const id = r.dirs[0].id;
  applyScores(r, [
    { dirId: id, stance: 'supportive', score: 3, failed: false },
    { dirId: id, stance: 'adversarial', score: 2, failed: false },
  ]);
  assert.equal(r.dirs[0].status, 'covered');
});

// ---- Phase-D reopen (issue A fix) -------------------------------------------

test('addOrReopenDirection adds a fresh direction', () => {
  const r = seed(['A']);
  const before = r.dirs.length;
  addOrReopenDirection(r, { name: 'Gap-closer', note: 'closes recency flag' });
  assert.equal(r.dirs.length, before + 1);
  assert.equal(r.dirs.at(-1).status, 'open');
});

test('re-proposing the same direction name across rounds does NOT duplicate it', () => {
  // Reproduces the e2e bug: the synthesizer proposed the same gap in round 1 and
  // round 2; salted IDs differed, so duplicates accumulated. Dedup by name fixes it.
  const r = seed(['A']);
  const before = r.dirs.length;
  addOrReopenDirection(r, { name: 'Browser support matrix from primary sources', note: 'round 1' });
  addOrReopenDirection(r, { name: 'Browser support matrix from primary sources (Safari, Firefox)', note: 'round 2' });
  assert.equal(r.dirs.length, before + 1); // one direction, not two
});

test('normName collapses parentheticals and punctuation for dedup', () => {
  assert.equal(
    normName('CDN path-leak behavior (Fastly, Akamai)'),
    normName('CDN path-leak behavior')
  );
});

test('reopen resets a covered direction back to no/no/open (Phase-D closer)', () => {
  const r = seed(['A']);
  const id = r.dirs[0].id;
  r.dirs[0].supportive = YES;
  r.dirs[0].adversarial = YES;
  r.dirs[0].status = 'covered';
  addOrReopenDirection(r, { id, note: 'recheck currency' }, true);
  assert.equal(r.dirs[0].supportive, NO);
  assert.equal(r.dirs[0].adversarial, NO);
  assert.equal(r.dirs[0].status, 'open');
});

// ---- convergence (all three conditions) -------------------------------------

test('not converged while any direction is uncovered', () => {
  const r = seed(['A', 'B']);
  applyScores(r, [
    { dirId: r.dirs[0].id, stance: 'supportive', score: 2, failed: false },
    { dirId: r.dirs[0].id, stance: 'adversarial', score: 2, failed: false },
  ]);
  assert.equal(isConverged(r, 2, 0), false); // B still open
});

test('not converged while a Phase-D flag is open, even if fully covered', () => {
  const r = seed(['A']);
  applyScores(r, [
    { dirId: r.dirs[0].id, stance: 'supportive', score: 2, failed: false },
    { dirId: r.dirs[0].id, stance: 'adversarial', score: 2, failed: false },
  ]);
  assert.equal(isConverged(r, 2, 1), false); // one open flag blocks it
  assert.equal(isConverged(r, 2, 0), true);
});

test('not converged until 2 dry rounds even if covered and no flags', () => {
  const r = seed(['A']);
  applyScores(r, [
    { dirId: r.dirs[0].id, stance: 'supportive', score: 2, failed: false },
    { dirId: r.dirs[0].id, stance: 'adversarial', score: 2, failed: false },
  ]);
  assert.equal(isConverged(r, 1, 0), false);
  assert.equal(isConverged(r, 2, 0), true);
});

test('a FAILED stance blocks convergence (issue: discarded hard-gate fail)', () => {
  const r = seed(['A']);
  r.dirs[0].supportive = YES;
  r.dirs[0].adversarial = FAILED;
  assert.equal(isConverged(r, 5, 0), false);
});

// ---- markdown flush ----------------------------------------------------------

test('roadmapToMarkdown emits a coverage line with passing flag', () => {
  const r = seed(['A']);
  r.dirs[0].supportive = YES;
  const md = roadmapToMarkdown(r);
  assert.match(md, /coverage: supportive=yes adversarial=no passing=yes/);
});

test('stateToMarkdown round-trips the loop counters', () => {
  const cfg = {
    goal: 'g',
    audience: 'a',
    workingDir: '/tmp/x',
    roundCap: 5,
    workerCount: 4,
  };
  const md = stateToMarkdown(cfg, 3, 1, false);
  assert.match(md, /round: 3/);
  assert.match(md, /rounds_without_new_directions: 1/);
  assert.match(md, /converged: false/);
});

// ---- end-to-end logic simulation (no API) -----------------------------------
// Drives the full deterministic loop with a stub "judge" to prove the loop
// converges and terminates correctly without ever calling a model.

test('full deterministic loop converges and terminates', () => {
  const cfg = {
    goal: 'g',
    audience: 'a',
    workingDir: '/tmp/x',
    roundCap: 5,
    workerCount: 4,
  };
  const roadmap = seed(['A', 'B']);
  let round = 0;
  let dry = 0;
  let converged = false;

  while (!converged && round < cfg.roundCap) {
    round++;
    const assignments = assignWorkers(roadmap, cfg.workerCount);
    // stub judge: every worker passes; no new directions; no flags.
    const scored = assignments.map((a) => ({
      dirId: a.dirId,
      stance: a.stance,
      score: 3,
      failed: false,
    }));
    applyScores(roadmap, scored);
    const newDirs = 0; // stub: no new directions
    dry = newDirs ? 0 : dry + 1;
    converged = isConverged(roadmap, dry, 0);
  }

  assert.equal(converged, true);
  assert.ok(round <= cfg.roundCap);
  // A and B both covered
  assert.ok(roadmap.dirs.every((d) => d.status === 'covered'));
});

test('loop respects the round cap when it never converges', () => {
  const cfg = { roundCap: 3, workerCount: 2 };
  const roadmap = seed(['A']);
  let round = 0;
  let dry = 0;
  let converged = false;
  while (!converged && round < cfg.roundCap) {
    round++;
    const assignments = assignWorkers(roadmap, cfg.workerCount);
    // stub judge: every worker HARD-FAILS -> never converges
    const scored = assignments.map((a) => ({
      dirId: a.dirId,
      stance: a.stance,
      score: 0,
      failed: true,
    }));
    applyScores(roadmap, scored);
    converged = isConverged(roadmap, (dry += 1), 0);
  }
  assert.equal(converged, false);
  assert.equal(round, 3); // stopped at cap
});
