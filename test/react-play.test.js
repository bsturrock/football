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

// T-13 restated by F-55 #4 (vertical combo drive, no playside lean): the base C/LG double drives RDT upfield by 1.6 s
// and does not latch his anchor backside on the first engaged tick (lateral travel toward the backside stays small).
test('T-13: base C/LG double drives RDT 1 yd upfield by 1.6 s (anchor not latched backside)', () => {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'base' });
  let side = 0;
  const orig = play.retargetRule;
  play.retargetRule = (pl, b, ctx) => { side = ctx.side; orig(pl, b, ctx); return []; };
  play.snap();
  const RDT = play.player('RDT');
  const x0 = RDT.x;
  const y0 = RDT.y;
  let minSide = Infinity;
  for (let i = 0; i < Math.round(1.6 / DT); i++) {
    play.step(DT);
    minSide = Math.min(minSide, side * (RDT.x - x0));
  }
  assert.ok(RDT.y - y0 >= 1.0, `RDT moved ${(RDT.y - y0).toFixed(2)} yd upfield by 1.6 s`);
  assert.ok(minSide >= -0.5, `side ${side} RDT drifted ${minSide.toFixed(2)} yd backside`);
});

// F-3 #3 restated by F-55 #4 (the human now asks for vertical movement first): a held double drives its DL
// straight upfield (hips together, no playside lean): net upfield travel while both are on, and less sideways than upfield.
test('F-3 #3 drive: every held double moves its DL upfield, more upfield than sideways, while both men are on', (t) => {
  const fronts = Object.keys(FRONTS);
  const variants = [{}, { personnel: 'te' }];
  const out = [];
  for (const front of fronts) {
    for (const opts of variants) {
      for (const playside of ['left', 'right']) {
        const label = opts.personnel ?? 'default';
        const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, playside, ...opts });
        play.snap();
        const tracks = play.combos.map((c) => {
          const dl = play.player(c.target);
          return { c, dl, pt: play.player(c.partner), ob: play.player(c.owner), both: null, x1: 0, y1: 0, end: null, dx: 0, dy: 0 };
        });
        const steps = Math.round(2.0 / DT);
        for (let i = 1; i <= steps; i++) {
          play.step(DT);
          const t0 = i * DT;
          for (const k of tracks) {
            const engaged = (p) => p.block?.target === k.c.target && p.block?.engaged;
            const on = engaged(k.ob) && engaged(k.pt);
            if (k.both === null && on) { k.both = t0; k.x1 = k.dl.x; k.y1 = k.dl.y; }
            if (k.both !== null && k.end === null) {
              if (!on || t0 - k.both > 0.85 + 1e-9) k.end = t0;
              else { k.dx = k.dl.x - k.x1; k.dy = k.dl.y - k.y1; }
            }
          }
        }
        tracks.forEach((k, idx) => {
          const name = `${front}, ${label}, ${playside}, combo ${idx} (${k.c.owner}+${k.c.partner} on ${k.c.target})`;
          assert.ok(k.both !== null, `${name}: both men never got on`);
          assert.ok(k.dy > 0, `${name}: DL moved ${k.dy.toFixed(3)} yd upfield (both on at ${k.both.toFixed(2)} s)`);
          assert.ok(Math.abs(k.dx) < k.dy, `${name}: lateral ${Math.abs(k.dx).toFixed(3)} yd not less than upfield ${k.dy.toFixed(3)} yd`);
          out.push(`${name}: both ${k.both.toFixed(2)} dy ${k.dy.toFixed(2)} dx ${k.dx.toFixed(2)}`);
        });
      }
    }
  }
  t.diagnostic(out.join('\n'));
});

// F-55 #5: every backside cutoff man steps inside (phase 'step'), then hinges, and stays on the playside of his man.
test('F-55 #5: backside cutoff steps inside then hinges', (t) => {
  const out = [];
  let cutoffs = 0;
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      for (const playside of ['left', 'right']) {
        const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, personnel, playside });
        play.snap();
        const side = play.plan.side;
        const seen = new Map();
        const steps = Math.round(2.0 / DT);
        for (let i = 1; i <= steps; i++) {
          play.step(DT);
          for (const b of play.players) {
            const f = b.block?.foot;
            if (!f || f.tech !== 'cutoff') continue;
            const name = `${front}, ${personnel}, ${playside}, ${b.id} on ${b.block.target}`;
            const rec = seen.get(b.id) ?? { hinged: false, steppedFirst: null, name };
            seen.set(b.id, rec);
            if (rec.steppedFirst === null) rec.steppedFirst = f.phase === 'step';
            if (f.phase === 'hinge') rec.hinged = true;
            else assert.ok(!rec.hinged, `${name}: back in phase ${f.phase} after hinge`);
            if (b.block.engaged && f.phase === 'hinge') {
              const man = play.player(b.block.target);
              const lat = side * (b.x - man.x);
              assert.ok(lat >= -BODY_RADIUS - 1e-9, `${name}: tick ${i} blocker x ${b.x.toFixed(2)} man x ${man.x.toFixed(2)} goal ${JSON.stringify(b.block.goal ?? null)} lateral ${lat.toFixed(2)}`);
            }
          }
        }
        for (const r of seen.values()) {
          cutoffs++;
          assert.ok(r.steppedFirst, `${r.name}: first phase was not step`);
          assert.ok(r.hinged, `${r.name}: never reached hinge`);
          out.push(r.name);
        }
      }
    }
  }
  assert.ok(cutoffs > 0, 'no cutoff blockers found');
  t.diagnostic(`${cutoffs} cutoff men: ${out.join('; ')}`);
});
