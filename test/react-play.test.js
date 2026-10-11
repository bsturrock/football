import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BODY_RADIUS, contactSpot, resolveBlock, stepBlocking } from '../src/dots/blocking.js';
import { startFoot } from '../src/dots/technique.js';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';

const DT = 1 / 60;

function fixture(ball) {
  const D = { id: 'D', team: 'defense', role: 'DT', x: 0, y: 25.7, speed: 6.5, strength: 0.6, block: null };
  const A = { id: 'A', team: 'offense', role: 'OL', x: -1, y: 24, speed: 6, strength: 1 };
  const B = { id: 'B', team: 'offense', role: 'OL', x: 1, y: 24, speed: 6, strength: 1 };
  A.block = { target: 'D', angle: 'straight', engaged: true, seq: 1 };
  B.block = { target: 'D', angle: 'straight', engaged: true, seq: 2 };
  const players = [D, A, B];
  for (const b of [A, B]) {
    const s = contactSpot(players, b);
    b.x = s.x;
    b.y = s.y;
    b.block.foot = startFoot('zone', 'head', null, b, D);
  }
  return { players, D, A, B, ball };
}

function run(ball, secs, onStep) {
  const f = fixture(ball);
  const ctx = { seq: 2 };
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    stepBlocking(f.players, ball, DT, ctx);
    onStep?.(f, (i + 1) * DT);
  }
  return f;
}

test('double-teamed defender anchors, shifts toward the ball, ride pushes him that way', () => {
  let drivenBefore = false;
  let anchoredAt = null;
  const f = run({ x: -3, y: 21 }, 1.0, (g, t) => {
    const s = g.D.react?.state;
    if (s === 'driven' && anchoredAt === null) drivenBefore = true;
    if (s === 'anchored' && anchoredAt === null) anchoredAt = t;
  });
  assert.ok(drivenBefore, 'driven before anchored');
  assert.ok(anchoredAt !== null && anchoredAt <= 0.5 + 1e-9, `anchored at ${anchoredAt}`);
  assert.equal(f.D.react.side, -1);
  // ride > 0 turns the push toward -x, the ball side.
  assert.ok(f.A.block.foot.ride > 0, `A ride ${f.A.block.foot.ride}`);
  assert.ok(f.B.block.foot.ride > 0, `B ride ${f.B.block.foot.ride}`);
  assert.ok(f.A.block.foot.push.x < 0);
  assert.ok(f.B.block.foot.push.x < 0);
  assert.ok(f.D.x <= -0.2, `D.x ${f.D.x}`);
});

test('control: ball straight ahead keeps the defender centred', () => {
  const f = run({ x: 0, y: 21 }, 1.0);
  assert.ok(Math.abs(f.D.x) < 0.05, `D.x ${f.D.x}`);
});

test('free defender has null react', () => {
  const D = { id: 'D', team: 'defense', role: 'DT', x: 0, y: 25.7, speed: 6.5, strength: 0.6, block: null, react: { state: 'driven' } };
  stepBlocking([D], { x: -3, y: 21 }, DT, { seq: 0 });
  assert.equal(D.react, null);
});

test('resolveBlock follows react.dir', () => {
  const d = { x: 0, y: 10, strength: 0.6, react: { dir: { x: -1, y: 0 } } };
  const v = resolveBlock(d, [], { x: 0, y: 0 });
  assert.ok(v.vx < 0);
  assert.ok(Math.abs(v.vy) < 1e-9);
});

test('double-team drift levels off', () => {
  const at = {};
  run({ x: -3, y: 21 }, 5.0, (g, t) => {
    const k = Math.round(t * 60);
    if (k === 120 || k === 180 || k === 300) at[k] = { x: g.D.x, y: g.D.y - 25.7 };
  });
  const x2 = at[120].x; const y2 = at[120].y;
  const x3 = at[180].x; const y3 = at[180].y;
  const x5 = at[300].x; const y5 = at[300].y;
  assert.ok(Math.abs(x3) - Math.abs(x2) < 0.2, `x2 ${x2} x3 ${x3}`);
  assert.ok(y3 - y2 < 0.2, `y2 ${y2} y3 ${y3}`);
  assert.ok(Math.abs(x5) <= 2.5, `x5 ${x5}`);
  // The floor is a body width: the double team still moves him that far toward the ball (x = -3). Interim floor; the sideways drive is restored by R-68.
  assert.ok(x5 < 0, `x5 ${x5}`);
  assert.ok(Math.abs(x5) >= 2 * BODY_RADIUS, `x5 ${x5}`);
  assert.ok(y5 <= 2.0, `y5 ${y5}`);
});

test('straight double team stays centred and bounded in depth', () => {
  const f = run({ x: 0, y: 21 }, 5.0);
  assert.ok(f.D.y - 25.7 <= 2.0, `D.y ${f.D.y}`);
  assert.ok(Math.abs(f.D.x) < 0.05, `D.x ${f.D.x}`);
});

// T-13: the base C/LG double on RDT must drive him playside, not latch his anchor backside on the first engaged tick.
test('T-13: base C/LG double drives RDT 1 yd playside by 1.6 s (anchor not latched backside)', () => {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'base' });
  let side = 0;
  const orig = play.retargetRule;
  play.retargetRule = (pl, b, ctx) => { side = ctx.side; orig(pl, b, ctx); return []; };
  play.snap();
  const RDT = play.player('RDT');
  const x0 = RDT.x;
  let reached = false;
  for (let i = 0; i < Math.round(1.6 / DT) && !reached; i++) {
    play.step(DT);
    reached = side * (RDT.x - x0) >= 1.0;
  }
  assert.ok(reached, `side ${side} RDT moved ${side * (RDT.x - x0)} yd playside by 1.6 s`);
});

// F-3 #3: every held double moves its DL 1 yd playside and 0.2 yd back within 0.85 s of both men getting on.
test('F-3 #3 drive: every held double moves its DL 1 yd playside and 0.2 yd back within 0.85 s of both men getting on', (t) => {
  const fronts = Object.keys(FRONTS);
  const variants = [{}, { personnel: 'te' }];
  const reaches = [];
  for (const front of fronts) {
    for (const opts of variants) {
      const label = opts.personnel ?? 'default';
      const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, ...opts });
      let side = 0;
      play.retargetRule = (pl, b, ctx) => { side = ctx.side; return []; };
      play.snap();
      const tracks = play.combos.map((c) => {
        const dl = play.player(c.target);
        return { c, dl, pt: play.player(c.partner), ob: play.player(c.owner), x0: dl.x, both: null, y1: null, reach: null };
      });
      const steps = Math.round(2.0 / DT);
      for (let i = 1; i <= steps; i++) {
        play.step(DT);
        const t0 = i * DT;
        for (const k of tracks) {
          const engaged = (p) => p.block?.target === k.c.target && p.block?.engaged;
          if (k.both === null && engaged(k.ob) && engaged(k.pt)) {
            k.both = t0;
            k.y1 = k.dl.y;
          }
          if (k.both !== null && k.reach === null && t0 - k.both >= 0.3 - 1e-9
            && side * (k.dl.x - k.x0) >= 1.0 && k.dl.y - k.y1 >= 0.2) {
            k.reach = t0;
          }
        }
      }
      tracks.forEach((k, idx) => {
        const name = `${front}, ${label}, combo ${idx} (${k.c.owner}+${k.c.partner} on ${k.c.target})`;
        assert.ok(k.both !== null, `${name}: both men never got on`);
        assert.ok(k.reach !== null, `${name}: DL never reached 1 yd playside and 0.2 yd back (side ${side}, both ${k.both.toFixed(2)} s, x moved ${(side * (k.dl.x - k.x0)).toFixed(2)} yd)`);
        const gap = k.reach - k.both;
        assert.ok(gap <= 0.85 + 1e-9, `${name}: reach ${k.reach.toFixed(2)} s is ${gap.toFixed(2)} s after both ${k.both.toFixed(2)} s (max 0.85)`);
        reaches.push(`${name}: both ${k.both.toFixed(2)} reach ${k.reach.toFixed(2)} gap ${gap.toFixed(2)}`);
      });
    }
  }
  t.diagnostic(reaches.join('\n'));
});
