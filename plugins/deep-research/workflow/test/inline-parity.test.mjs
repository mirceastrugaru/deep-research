import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as core from '../research-core.mjs';

// Guard against drift between the tested core module and the verbatim inline
// copy embedded in the workflow script (the sandbox can't import, so the copy
// is unavoidable; this test proves the copy still behaves identically).

const here = dirname(fileURLToPath(import.meta.url));
const wfSrc = readFileSync(join(here, '..', 'deep-research.workflow.js'), 'utf8');

// Slice the inline core block out of the workflow source and evaluate it into
// an isolated module namespace, then compare behavior to the real module.
function loadInlineCore() {
  const start = wfSrc.indexOf('function dirId');
  assert.ok(start > -1, 'inline core block not found in workflow');
  // the inline block ends before the SCHEMAS banner
  const endBanner = wfSrc.indexOf('// SCHEMAS');
  const block = wfSrc.slice(start, endBanner);
  // expose the functions by appending a return of the ones we test
  const factory = new Function(`
    ${block}
    return { loadRoadmap, assignWorkers, applyScores, addOrReopenDirection, shouldStop, isCovered, hasFailedStance, dirId, normName, findDir, roadmapToMarkdown };
  `);
  return factory();
}

const inline = loadInlineCore();

test('inline dirId matches module dirId', () => {
  for (const [n, s] of [['Alpha', '0'], ['Beta market sizing', '3'], ['x', '']]) {
    assert.equal(inline.dirId(n, s), core.dirId(n, s));
  }
});

test('inline assignWorkers matches module on a mixed roadmap', () => {
  const seedDirs = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
  const rm = core.loadRoadmap(seedDirs);
  const ri = inline.loadRoadmap(seedDirs);
  // mutate both identically
  rm.dirs[0].supportive = 'yes'; ri.dirs[0].supportive = 'yes';
  rm.dirs[1].adversarial = 'FAILED_NEEDS_RERUN'; ri.dirs[1].adversarial = 'FAILED_NEEDS_RERUN';
  assert.deepEqual(
    inline.assignWorkers(ri, 4).map((x) => ({ dirId: x.dirId, stance: x.stance })),
    core.assignWorkers(rm, 4).map((x) => ({ dirId: x.dirId, stance: x.stance }))
  );
});

test('inline applyScores + shouldStop match the module', () => {
  const seedDirs = [{ name: 'A' }];
  const rm = core.loadRoadmap(seedDirs);
  const ri = inline.loadRoadmap(seedDirs);
  const scored = [
    { dirId: rm.dirs[0].id, stance: 'supportive', score: 3, failed: false },
    { dirId: rm.dirs[0].id, stance: 'adversarial', score: 2, failed: false },
  ];
  core.applyScores(rm, scored);
  inline.applyScores(ri, scored.map((s) => ({ ...s, dirId: ri.dirs[0].id })));
  assert.equal(rm.dirs[0].status, ri.dirs[0].status); // both 'covered'
  assert.equal(inline.shouldStop(2, 5), core.shouldStop(2, 5)); // both false — cap not reached
  assert.equal(inline.shouldStop(5, 5), true);
});

test('inline normName + dedup match the module', () => {
  assert.equal(inline.normName('Foo (bar, baz)'), core.normName('Foo (bar, baz)'));
  const rm = core.loadRoadmap([{ name: 'A' }]);
  const ri = inline.loadRoadmap([{ name: 'A' }]);
  core.addOrReopenDirection(rm, { name: 'Gap X from primary sources' });
  core.addOrReopenDirection(rm, { name: 'Gap X from primary sources (extra)' });
  inline.addOrReopenDirection(ri, { name: 'Gap X from primary sources' });
  inline.addOrReopenDirection(ri, { name: 'Gap X from primary sources (extra)' });
  assert.equal(ri.dirs.length, rm.dirs.length);
  assert.equal(ri.dirs.length, 2); // seed A + one Gap X, no duplicate
});

test('inline addOrReopenDirection reopen matches the module', () => {
  const rm = core.loadRoadmap([{ name: 'A' }]);
  const ri = inline.loadRoadmap([{ name: 'A' }]);
  for (const r of [rm, ri]) { r.dirs[0].supportive = 'yes'; r.dirs[0].adversarial = 'yes'; r.dirs[0].status = 'covered'; }
  core.addOrReopenDirection(rm, { id: rm.dirs[0].id, note: 'recheck' }, true);
  inline.addOrReopenDirection(ri, { id: ri.dirs[0].id, note: 'recheck' }, true);
  assert.equal(ri.dirs[0].status, rm.dirs[0].status);
  assert.equal(ri.dirs[0].supportive, 'no');
});

test('inline findDir matches the module', () => {
  const rm = core.loadRoadmap([{ name: 'A' }, { name: 'B' }]);
  const ri = inline.loadRoadmap([{ name: 'A' }, { name: 'B' }]);
  const id = rm.dirs[1].id;
  assert.equal(inline.findDir(ri, id).name, core.findDir(rm, id).name);
  assert.equal(inline.findDir(ri, 'nope'), undefined);
});

test('inline roadmapToMarkdown matches the module byte for byte', () => {
  const seedDirs = [{ name: 'Alpha', note: 'first' }, { name: 'Beta', note: 'second' }];
  const rm = core.loadRoadmap(seedDirs);
  const ri = inline.loadRoadmap(seedDirs);
  rm.dirs[0].supportive = 'yes'; ri.dirs[0].supportive = 'yes';
  assert.equal(inline.roadmapToMarkdown(ri), core.roadmapToMarkdown(rm));
});

test('inline addOrReopenDirection depth + 15-cap parent guard match the module', () => {
  const rm = core.loadRoadmap([{ name: 'A' }]);
  const ri = inline.loadRoadmap([{ name: 'A' }]);
  const childM = core.addOrReopenDirection(rm, { name: 'child', parent: rm.dirs[0].id });
  const childI = inline.addOrReopenDirection(ri, { name: 'child', parent: ri.dirs[0].id });
  assert.equal(childI.depth, childM.depth);
  assert.equal(childI.depth, 1);
});
