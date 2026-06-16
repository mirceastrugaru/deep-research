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
  shouldStop,
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

test('a re-run assignment is flagged isRerun so the worker is warned', () => {
  const r = seed(['A']);
  r.dirs[0].supportive = FAILED; // failed verification last round
  const a = assignWorkers(r, 1);
  assert.equal(a[0].stance, 'supportive');
  assert.equal(a[0].isRerun, true);
  // a fresh, never-failed assignment is not a re-run
  const r2 = seed(['B']);
  assert.equal(assignWorkers(r2, 1)[0].isRerun, false);
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

test('the 15-cap never kills a direction that is a parent of a live child', () => {
  // Reproduces the review bug: the cap killed any covered direction, orphaning
  // its open child and corrupting the tree.
  const r = seed(['seed']);
  const parent = r.dirs[0];
  parent.supportive = YES; parent.adversarial = YES; parent.status = 'covered';
  // give it an open child
  addOrReopenDirection(r, { name: 'open child', parent: parent.id });
  // now flood past 15 with covered, childless directions so the cap fires
  for (let i = 0; i < 16; i++) {
    const d = addOrReopenDirection(r, { name: `filler ${i}` });
    d.supportive = YES; d.adversarial = YES; d.status = 'covered';
  }
  // the parent must NOT be the victim — it has a live child
  assert.equal(parent.status, 'covered', 'parent with a live child was spared');
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

// ---- stop condition (round cap is the only stop — 1.6+ tree model) ----------

test('shouldStop is false until the round reaches the cap', () => {
  assert.equal(shouldStop(1, 5), false);
  assert.equal(shouldStop(4, 5), false);
  assert.equal(shouldStop(5, 5), true);
  assert.equal(shouldStop(6, 5), true);
});

test('a fully-covered roadmap does NOT stop early — only the cap stops', () => {
  // The whole point of the 1.6 change: coverage complete is not a stop.
  const r = seed(['A']);
  applyScores(r, [
    { dirId: r.dirs[0].id, stance: 'supportive', score: 2, failed: false },
    { dirId: r.dirs[0].id, stance: 'adversarial', score: 2, failed: false },
  ]);
  assert.equal(r.dirs[0].status, 'covered');
  assert.equal(shouldStop(2, 5), false); // still 3 rounds of budget left
});

// ---- tree deepening ----------------------------------------------------------

test('a child links to its parent BY NAME, not just by id (live-run bug)', () => {
  // The synthesizer returns parent as a label, not a d- id. The tree must still
  // link and the child must get depth 1, else the tree never deepens.
  const r = seed(['Model lineup and API of Cohere vs Mistral']);
  const parentId = r.dirs[0].id;
  // parent given as the NAME (what the agent actually sends), not the id
  const child = addOrReopenDirection(r, {
    name: 'Cohere models and pricing',
    parent: 'Model lineup and API of Cohere vs Mistral',
  });
  assert.equal(child.depth, 1, 'child got depth 1 from a name-matched parent');
  assert.equal(child.parent, parentId, 'child.parent stored as the resolved id, not the label');
});

test('an unresolvable parent label yields a depth-0 root, not a broken link', () => {
  const r = seed(['A']);
  const child = addOrReopenDirection(r, { name: 'orphan', parent: 'nonexistent label' });
  assert.equal(child.depth, 0);
  assert.equal(child.parent, '-'); // unresolved -> treated as a root, no dangling ref
});

test('a judge-spawned child gets depth = parent depth + 1', () => {
  const r = seed(['A']); // depth 0
  const child = addOrReopenDirection(r, { name: 'child of A', parent: r.dirs[0].id });
  assert.equal(child.depth, 1);
  const grandchild = addOrReopenDirection(r, { name: 'child of child', parent: child.id });
  assert.equal(grandchild.depth, 2);
});

test('assignment widens the tree before deepening (shallower depth first)', () => {
  const r = seed(['A']);
  // A fully covered; it has a depth-1 child and a depth-2 grandchild, both unstarted.
  r.dirs[0].supportive = YES; r.dirs[0].adversarial = YES; r.dirs[0].status = 'covered';
  const child = addOrReopenDirection(r, { name: 'child', parent: r.dirs[0].id });
  const grand = addOrReopenDirection(r, { name: 'grand', parent: child.id });
  const a = assignWorkers(r, 2);
  // both slots should go to the shallower child (depth 1), not the grandchild (depth 2)
  assert.ok(a.every((s) => s.dirId === child.id), 'shallower child assigned first');
  assert.ok(a.every((s) => s.dirId !== grand.id), 'grandchild deferred');
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
  const md = stateToMarkdown(cfg, 3, false); // round 3, not yet at cap
  assert.match(md, /round: 3/);
  assert.match(md, /round_cap: 5/);
  assert.match(md, /converged: false/);
  assert.match(stateToMarkdown(cfg, 5, true), /converged: true/); // at cap
});

// ---- end-to-end logic simulation (no API) -----------------------------------
// Drives the full deterministic loop with a stub judge to prove it runs exactly
// round_cap rounds (the only stop) and never calls a model.

test('the loop runs exactly round_cap rounds, never stopping early', () => {
  const cfg = { goal: 'g', audience: 'a', workingDir: '/tmp/x', roundCap: 5, workerCount: 4 };
  const roadmap = seed(['A', 'B']);
  let round = 0;
  while (!shouldStop(round, cfg.roundCap)) {
    round++;
    const assignments = assignWorkers(roadmap, cfg.workerCount);
    if (assignments.length === 0) break; // ran out of stances before the cap
    // stub judge: every worker passes; spawn one child each round to keep the tree alive.
    const scored = assignments.map((a) => ({ dirId: a.dirId, stance: a.stance, score: 3, failed: false }));
    applyScores(roadmap, scored);
    addOrReopenDirection(roadmap, { name: `child round ${round}`, parent: roadmap.dirs[0].id });
  }
  assert.equal(round, 5); // ran the full budget, not stopped early by coverage
});

test('a never-passing run still stops exactly at the cap', () => {
  const cfg = { roundCap: 3, workerCount: 2 };
  const roadmap = seed(['A']);
  let round = 0;
  while (!shouldStop(round, cfg.roundCap)) {
    round++;
    const assignments = assignWorkers(roadmap, cfg.workerCount);
    const scored = assignments.map((a) => ({ dirId: a.dirId, stance: a.stance, score: 0, failed: true }));
    applyScores(roadmap, scored);
  }
  assert.equal(round, 3); // stopped at cap regardless of scores
});
