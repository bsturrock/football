import test from 'node:test';
import assert from 'node:assert/strict';
import { project, leadPoint } from '../src/dots/geometry.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test('project moves along vel, and a missing vel stands still', () => {
  assert.deepEqual(project({ x: 1, y: 2 }, { x: 2, y: -1 }, 3), { x: 7, y: -1 });
  assert.deepEqual(project({ x: 1, y: 2 }, null, 3), { x: 1, y: 2 });
  assert.deepEqual(project({ x: 1, y: 2 }, undefined, 3), { x: 1, y: 2 });
});

test('leadPoint meets a crossing target ahead of his spot', () => {
  const from = { x: 0, y: 0 };
  const r = leadPoint(from, 5, { x: 10, y: 5 }, { x: -3, y: 0 });
  assert.equal(r.met, true);
  assert.ok(r.x < 10);
  near(Math.hypot(r.x - from.x, r.y - from.y), 5 * r.t);
});

test('leadPoint on a still target returns the spot', () => {
  const r = leadPoint({ x: 0, y: 0 }, 5, { x: 3, y: 4 }, { x: 0, y: 0 });
  assert.deepEqual({ x: r.x, y: r.y }, { x: 3, y: 4 });
  assert.equal(r.met, true);
  near(r.t, 1);
  const n = leadPoint({ x: 0, y: 0 }, 5, { x: 3, y: 4 }, null);
  assert.deepEqual({ x: n.x, y: n.y }, { x: 3, y: 4 });
});

test('leadPoint on a faster target running away is not met', () => {
  const a = leadPoint({ x: 0, y: 0 }, 2, { x: 0, y: 5 }, { x: 0, y: 6 });
  assert.equal(a.met, false);
  assert.equal(a.t, 0);
  assert.deepEqual({ x: a.x, y: a.y }, { x: 0, y: 5 });
  const b = leadPoint({ x: 0, y: 0 }, 2, { x: 0, y: 5 }, { x: 0, y: 6 }, { maxLead: 1.5 });
  assert.equal(b.met, false);
  assert.equal(b.t, 1.5);
  near(b.y, 14);
});

test('leadPoint maxLead caps a real root', () => {
  const r = leadPoint({ x: 0, y: 0 }, 5, { x: 10, y: 0 }, { x: 0, y: 3 }, { maxLead: 0.5 });
  assert.equal(r.met, true);
  assert.equal(r.t, 0.5);
  near(r.y, 1.5);
});

test('leadPoint age: seen 0.2 s ago equals seen now at the advanced spot', () => {
  const from = { x: 0, y: 0 };
  const v = { x: -2, y: 1 };
  const a = leadPoint(from, 6, { x: 8, y: 3 }, v, { age: 0.2 });
  const b = leadPoint(from, 6, { x: 8 + 0.2 * v.x, y: 3 + 0.2 * v.y }, v);
  near(a.x, b.x);
  near(a.y, b.y);
  near(a.t, b.t);
});

test('leadPoint linear case |v| = speed', () => {
  const from = { x: 0, y: 0 };
  const r = leadPoint(from, 3, { x: 4, y: 3 }, { x: -3, y: 0 });
  assert.equal(r.met, true);
  near(Math.hypot(r.x - from.x, r.y - from.y), 3 * r.t);
  const away = leadPoint(from, 3, { x: 0, y: 4 }, { x: 0, y: 3 });
  assert.equal(away.met, false);
});

test('leadPoint with speed 0 is finite', () => {
  for (const vel of [null, { x: 0, y: 0 }, { x: 1, y: 1 }]) {
    const r = leadPoint({ x: 0, y: 0 }, 0, { x: 3, y: 4 }, vel);
    for (const k of ['x', 'y', 't']) assert.ok(Number.isFinite(r[k]));
  }
  const r = leadPoint({ x: 3, y: 4 }, 0, { x: 3, y: 4 }, null);
  assert.equal(r.met, true);
  assert.equal(r.t, 0);
});
