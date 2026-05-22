// Unit tests for the reveal-phase poll-stop decision in countdown-vote/vote-main.js.
//
// vote-main.js is a non-module IIFE loaded as a plain <script> in the browser, so we
// can't `import` from it. To keep the test exercising the EXACT source the browser
// runs (no copy/duplicate, no drift), we extract the pure stop-decision function
// verbatim between two markers and evaluate it in an isolated `node:vm` context.
//
// The marker block in vote-main.js MUST define a function named `evaluateRevealStop`
// that is closure-free (depends only on its single `input` arg) so this extraction
// works in isolation.

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'vote-main.js'), 'utf8');

const BEGIN = '// ===PUNZI_REVEAL_STOP_BEGIN===';
const END   = '// ===PUNZI_REVEAL_STOP_END===';
const i0 = src.indexOf(BEGIN);
const i1 = src.indexOf(END);
if (i0 < 0 || i1 < 0 || i1 <= i0) {
  throw new Error('reveal-poll-stop markers not found in vote-main.js');
}
const fnSrc = src.slice(i0 + BEGIN.length, i1);

// Run the extracted block in an isolated VM context. A top-level
// `function evaluateRevealStop(){}` declaration becomes a property of the
// context object — that is the value the tests exercise.
const ctx = vm.createContext({});
vm.runInContext(fnSrc, ctx, { filename: 'vote-main.js#evaluateRevealStop' });
const evaluateRevealStop = ctx.evaluateRevealStop;
if (typeof evaluateRevealStop !== 'function') {
  throw new Error('extracted block did not define function evaluateRevealStop');
}

// Stop-decision tuning used by the tests (must match vote-main.js values).
const STABLE = 3;
const MAX    = 10 * 60 * 1000;
const T0     = 1_000_000;     // arbitrary base timestamp (ms)
const STEP   = 90_000;        // 90s poll cadence

// Helper: chain observations as the production code would, threading the
// returned `next*` fields into the next call's `prev*` slots.
function step(prev, obs) {
  return evaluateRevealStop({
    state:             obs.state,
    totalVotes:        obs.totalVotes,
    prevLastTotal:     prev ? prev.nextLastTotal     : null,
    prevStableCount:   prev ? prev.nextStableCount   : 0,
    prevFirstClosedAt: prev ? prev.nextFirstClosedAt : 0,
    now:               obs.now,
    stableTarget:      STABLE,
    maxWaitMs:         MAX,
  });
}

test('open/pre/null state never stops and does not advance stability', () => {
  for (const s of ['open', 'pre', null]) {
    const r = step(null, { state: s, totalVotes: 100, now: T0 });
    assert.equal(r.shouldStop,        false, `state=${s} should not stop`);
    assert.equal(r.nextLastTotal,     null,  `state=${s} should not track total`);
    assert.equal(r.nextStableCount,   0,     `state=${s} should not advance stable count`);
    assert.equal(r.nextFirstClosedAt, 0,     `state=${s} should not set first-closed clock`);
  }
});

test('first closed observation anchors clock, sets stable=1, does not stop', () => {
  const r = step(null, { state: 'closed', totalVotes: 100, now: T0 });
  assert.equal(r.shouldStop,        false);
  assert.equal(r.nextLastTotal,     100);
  assert.equal(r.nextStableCount,   1);
  assert.equal(r.nextFirstClosedAt, T0);
});

test('three consecutive identical closed totals stop the poll', () => {
  let r = step(null, { state: 'closed', totalVotes: 100, now: T0 });
  assert.equal(r.shouldStop, false, 'after 1 obs');
  r = step(r, { state: 'closed', totalVotes: 100, now: T0 + STEP });
  assert.equal(r.shouldStop, false, 'after 2 obs');
  r = step(r, { state: 'closed', totalVotes: 100, now: T0 + 2 * STEP });
  assert.equal(r.shouldStop,        true, 'after 3 obs');
  assert.equal(r.nextStableCount,   3);
  assert.equal(r.nextLastTotal,     100);
  assert.equal(r.nextFirstClosedAt, T0);
});

test('a changing total resets stability run; recovery requires another 3', () => {
  let r = step(null, { state: 'closed', totalVotes: 100, now: T0 });
  r = step(r, { state: 'closed', totalVotes: 100, now: T0 + STEP });
  // stable=2 now
  r = step(r, { state: 'closed', totalVotes: 105, now: T0 + 2 * STEP });
  assert.equal(r.shouldStop,      false);
  assert.equal(r.nextStableCount, 1, 'reset on change');
  assert.equal(r.nextLastTotal,   105);
  r = step(r, { state: 'closed', totalVotes: 105, now: T0 + 3 * STEP });
  r = step(r, { state: 'closed', totalVotes: 105, now: T0 + 4 * STEP });
  assert.equal(r.shouldStop,      true,  'stops after 3 stable in new run');
  assert.equal(r.nextStableCount, 3);
});

test('10-min cap stops even when totals keep changing every poll', () => {
  let r = step(null, { state: 'closed', totalVotes: 100, now: T0 });
  r = step(r, { state: 'closed', totalVotes: 101, now: T0 + MAX - 1 });
  assert.equal(r.shouldStop, false, 'just inside the cap');
  r = step(r, { state: 'closed', totalVotes: 102, now: T0 + MAX });
  assert.equal(r.shouldStop,        true,  'at the cap');
  assert.equal(r.nextFirstClosedAt, T0,    'clock stays anchored to first closed obs');
});

test('first-closed clock anchors at first closed observation, not page load', () => {
  // 50s in the vote-open state, then closed flips on at T0+50000.
  let r = step(null, { state: 'open',   totalVotes: 99,  now: T0 });
  assert.equal(r.nextFirstClosedAt, 0);
  r = step(r, { state: 'closed', totalVotes: 100, now: T0 + 50_000 });
  assert.equal(r.nextFirstClosedAt, T0 + 50_000, 'anchors at first closed obs');
  r = step(r, { state: 'closed', totalVotes: 100, now: T0 + 50_000 + STEP });
  assert.equal(r.nextFirstClosedAt, T0 + 50_000, 'remains anchored');
});

test('closed->open regression does not advance stability and keeps clock anchored', () => {
  // Defensive: if the collector briefly reports 'open' again (clock skew /
  // glitch), we MUST NOT stop the poll. State must not advance.
  let r = step(null, { state: 'closed', totalVotes: 100, now: T0 });
  r = step(r, { state: 'open', totalVotes: 100, now: T0 + STEP });
  assert.equal(r.shouldStop,        false);
  assert.equal(r.nextStableCount,   1,   'stability frozen, not advanced');
  assert.equal(r.nextLastTotal,     100, 'last total preserved');
  assert.equal(r.nextFirstClosedAt, T0,  'first-closed clock preserved');
});
