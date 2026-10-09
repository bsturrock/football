import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REACT_STATES, ANCHOR_RATE, RECOVER_RATE, ANCHOR_MIN, ANCHOR_LATERAL,
  startReact, anchorSide, anchorDir, stepReact,
} from '../src/dots/react.js';

const DT = 1 / 60;
const PUSH = { x: 0, y: 1.4 };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
const unit = (x, y) => { const m = Math.hypot(x, y); return { x: x / m, y: y / m }; };
const def = (x, y) => ({ id: 'a', team: 'def', role: 'DL', x, y, speed: 5, strength: 5 });
const ball = { x: 0, y: -5 };

function drive(n, b = ball, dy = 0.01) {
  let r = null;
  let d = def(0, 10);
  r = stepReact(r, d, PUSH, b, DT);
  const out = [r];
  for (let i = 0; i < n; i++) {
    d = def(0, d.y + dy);
    r = stepReact(r, d, PUSH, b, DT);
    out.push(r);
  }
  return out;
}

test('REACT_STATES lists the four states', () => {
  assert.deepEqual([...REACT_STATES], ['neutral', 'driven', 'anchored', 'winning']);
});

test('startReact fields', () => {
  assert.deepEqual(startReact(def(1, 2)), {
    state: 'neutral', sx: 1, sy: 2, px: 1, py: 2, lean: 0, side: 0, dir: null,
  });
});

test('first call is neutral and faces the ball', () => {
  const d = def(0, 10);
  const r = stepReact(null, d, PUSH, ball, DT);
  assert.equal(r.state, 'neutral');
  assert.equal(r.lean, 0);
  const g = unit(ball.x - d.x, ball.y - d.y);
  near(r.dir.x, g.x);
  near(r.dir.y, g.y);
});

test('small forward move is driven while lean is low', () => {
  const rs = drive(1);
  assert.ok(rs[1].lean < ANCHOR_MIN);
  assert.equal(rs[1].state, 'driven');
});

test('lean rise and fall are rate limited', () => {
  const rs = drive(30);
  for (let i = 1; i < rs.length; i++) {
    assert.ok(rs[i].lean - rs[i - 1].lean <= ANCHOR_RATE * DT + 1e-12);
  }
  let r = rs[rs.length - 1];
  assert.ok(r.lean > 0);
  const d = def(0, 10.3);
  for (let i = 0; i < 20; i++) {
    const n = stepReact(r, d, { x: 0, y: 0 }, ball, DT);
    assert.ok(r.lean - n.lean <= RECOVER_RATE * DT + 1e-12);
    r = n;
  }
});

test('sustained drive anchors and leans back and toward the ball side', () => {
  const rs = drive(60);
  const r = rs[rs.length - 1];
  assert.ok(r.lean >= ANCHOR_MIN);
  assert.equal(r.state, 'anchored');
  assert.ok(r.dir.y < 0);
  const rl = drive(60, { x: -3, y: -5 });
  const l = rl[rl.length - 1];
  assert.equal(l.side, -1);
  assert.ok(l.dir.x < 0);
});

test('moving against the push is winning', () => {
  const r0 = stepReact(null, def(0, 10), PUSH, ball, DT);
  const r = stepReact(r0, def(0, 10 - 0.01), PUSH, ball, DT);
  assert.equal(r.state, 'winning');
});

test('zero push is neutral', () => {
  const r0 = stepReact(null, def(0, 10), PUSH, ball, DT);
  const r = stepReact(r0, def(0, 10.01), { x: 0, y: 0 }, ball, DT);
  assert.equal(r.state, 'neutral');
});

test('anchorSide keeps prevSide inside the deadzone', () => {
  assert.equal(anchorSide(1, def(0, 0), { x: 0.05, y: -3 }), 1);
  assert.equal(anchorSide(1, def(0, 0), { x: -0.05, y: -3 }), 1);
  assert.equal(anchorSide(1, def(0, 0), { x: -2, y: -3 }), -1);
});

test('anchorDir in the field frame', () => {
  const z = anchorDir(0, { x: 0, y: 1 });
  near(z.x, 0); near(z.y, -1);
  for (const s of [-1, 1]) {
    const e = unit(ANCHOR_LATERAL * s, -1);
    const a = anchorDir(s, { x: 0, y: 1 });
    near(a.x, e.x); near(a.y, e.y);
    const b = anchorDir(s, null);
    near(b.x, a.x); near(b.y, a.y);
  }
});

test('anchorDir in a mostly sideways push frame', () => {
  const pu = unit(1, 0.2);
  const a0 = anchorDir(0, pu);
  near(a0.x, -pu.x); near(a0.y, -pu.y);
  const a = anchorDir(1, pu);
  assert.ok(a.x * pu.x + a.y * pu.y < 0);
  assert.ok(a.x * pu.y + a.y * -pu.x > 0);
  assert.ok(a.x < -0.5);
});

test('frozen inputs do not throw', () => {
  const d = Object.freeze(def(0, 10));
  const r = Object.freeze(startReact(d));
  const push = Object.freeze({ x: 0, y: 1.4 });
  const b = Object.freeze({ x: 2, y: -5 });
  assert.doesNotThrow(() => stepReact(r, Object.freeze(def(0, 10.01)), push, b, DT));
});
