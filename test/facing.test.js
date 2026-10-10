import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { engagedOn } from '../src/dots/blocking.js';
import {
  FACE_RATE, FACE_MIN_SPEED, FACE_SETTLE, FACE_TOL,
  angleDiff, wrapAngle, facingDir, bearing, initFacing, stepFacing,
} from '../src/dots/facing.js';

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} !~ ${b}`);

test('angleDiff and wrapAngle wrap to the short way', () => {
  near(angleDiff(3, -3), 2 * Math.PI - 6);
  assert.ok(angleDiff(3, -3) > 0 && angleDiff(3, -3) < 0.29);
  near(angleDiff(-3, 3), -(2 * Math.PI - 6));
  near(angleDiff(0, 1), 1);
  near(wrapAngle(3 * Math.PI), Math.PI);
  near(wrapAngle(-Math.PI), Math.PI);
  near(wrapAngle(7), 7 - 2 * Math.PI);
  near(facingDir(0).y, 1);
  near(facingDir(Math.PI).y, -1);
  near(bearing({ x: 0, y: 0 }, { x: 1, y: 0 }), Math.PI / 2);
});

test('initFacing: offense 0, defense PI', () => {
  const ps = [{ team: 'offense' }, { team: 'defense' }];
  initFacing(ps);
  assert.equal(ps[0].facing, 0);
  assert.equal(ps[1].facing, Math.PI);
});

const mk = (id, team, x, y, extra = {}) => ({ id, team, role: 'X', x, y, speed: 5, strength: 1, facing: 0, ...extra });

test('blocker engaged on a target to his right turns at bounded rate and reaches it', () => {
  const b = mk('b', 'offense', 0, 0, { block: { engaged: true, target: 'd', held: 1 } });
  const d = mk('d', 'defense', 1, 0);
  const ps = [b, d];
  const goal = bearing(b, d);
  let before = b.facing;
  stepFacing(ps, {}, 0.01);
  near(angleDiff(before, b.facing), FACE_RATE * 0.01);
  for (let i = 0; i < 100; i++) {
    before = b.facing;
    stepFacing(ps, {}, 0.01);
    assert.ok(Math.abs(angleDiff(before, b.facing)) <= FACE_RATE * 0.01 + 1e-9);
  }
  near(b.facing, goal);
});

test('defender with two engaged blockers faces their mean', () => {
  const d = mk('d', 'defense', 0, 0, { facing: Math.PI });
  const a = mk('a', 'offense', -1, 1, { block: { engaged: true, target: 'd', held: 1 } });
  const c = mk('c', 'offense', 1, 3, { block: { engaged: true, target: 'd', held: 1 } });
  const ps = [d, a, c];
  for (let i = 0; i < 100; i++) stepFacing(ps, {}, 0.05);
  near(d.facing, bearing(d, { x: 0, y: 2 }));
});

test('free straight mover reaches his travel bearing in PI/FACE_RATE then holds', () => {
  const p = mk('p', 'offense', 0, 0, { facing: Math.PI });
  const dt = 1 / 60;
  const v = { x: 3, y: -2 };
  const goal = Math.atan2(v.x, v.y);
  let t = 0;
  for (let i = 0; i < 300; i++) {
    const prev = { p: { x: p.x, y: p.y } };
    p.x += v.x * dt; p.y += v.y * dt;
    stepFacing([p], prev, dt);
    t += dt;
    if (t > Math.PI / FACE_RATE + dt) near(p.facing, goal);
  }
  near(p.facing, goal);
});

test('travel below FACE_MIN_SPEED keeps facing exactly', () => {
  const p = mk('p', 'offense', 0, 0, { facing: 1.234 });
  const dt = 1 / 60;
  const prev = { p: { x: 0, y: 0 } };
  p.x = FACE_MIN_SPEED * 0.9 * dt;
  stepFacing([p], prev, dt);
  assert.equal(p.facing, 1.234);
});

test('stepFacing writes only facing', () => {
  const b = mk('b', 'offense', 0, 0, { block: { engaged: true, target: 'd', held: 1 } });
  const d = mk('d', 'defense', 1, 0);
  const ps = [b, d];
  const strip = (q) => { const { facing, ...r } = q; return r; };
  const snap = structuredClone(ps.map(strip));
  assert.equal(stepFacing(ps, { b: { x: -1, y: 0 } }, 0.1), undefined);
  assert.deepEqual(ps.map(strip), snap);
});

test('only facing.js assigns .facing in src/dots', () => {
  for (const f of fs.readdirSync(new URL('../src/dots/', import.meta.url)).filter((n) => n.endsWith('.js'))) {
    const src = fs.readFileSync(new URL(`../src/dots/${f}`, import.meta.url), 'utf8');
    assert.equal(/\.facing\s*=(?!=)/.test(src), f === 'facing.js', f);
  }
});

for (const front of Object.keys(FRONTS)) {
  test(`play scenario insideZone / ${front}: facing bounds hold every tick`, () => {
    const play = createPlay(25, 'insideZone', { front });
    for (const p of play.players) assert.equal(p.facing, p.team === 'offense' ? 0 : Math.PI);
    play.snap();
    const eng = {}; // OL id -> { target, base, cur, min, max }
    const sweeps = {};
    let t = 0;
    while (!play.result && t < 6) {
      const before = Object.fromEntries(play.players.map((p) => [p.id, p.facing]));
      play.step(FIXED_DT);
      t += FIXED_DT;
      for (const p of play.players) {
        assert.ok(Math.abs(angleDiff(before[p.id], p.facing)) <= FACE_RATE * FIXED_DT + 1e-9, `rate ${p.id}`);
        if (p.block?.engaged && p.block.held >= FACE_SETTLE) {
          const tg = play.player(p.block.target);
          assert.ok(Math.abs(angleDiff(p.facing, bearing(p, tg))) <= FACE_TOL, `item3 ${p.id} t=${t}`);
        }
      }
      for (const d of play.players) {
        const on = engagedOn(play.players, d.id);
        if (!on.length || !on.every((q) => q.block.held >= FACE_SETTLE)) continue;
        const m = { x: on.reduce((s, q) => s + q.x, 0) / on.length, y: on.reduce((s, q) => s + q.y, 0) / on.length };
        assert.ok(Math.abs(angleDiff(d.facing, bearing(d, m))) <= FACE_TOL, `item4 ${d.id} t=${t}`);
      }
      for (const p of play.players) {
        if (p.role !== 'OL') continue;
        const k = p.block?.engaged ? p.block.target : null;
        const e = eng[p.id];
        if (k === null) { delete eng[p.id]; continue; }
        if (!e || e.target !== k) {
          eng[p.id] = { target: k, last: p.facing, sum: 0, min: 0, max: 0 };
        } else {
          e.sum += angleDiff(e.last, p.facing);
          e.last = p.facing;
          e.min = Math.min(e.min, e.sum);
          e.max = Math.max(e.max, e.sum);
        }
        const s = eng[p.id];
        sweeps[p.id] = Math.max(sweeps[p.id] ?? 0, s.max - s.min);
      }
    }
    if (front === 'base') {
      assert.ok(Math.max(0, ...Object.values(sweeps)) >= 0.25, JSON.stringify(sweeps));
    }
  });
}
