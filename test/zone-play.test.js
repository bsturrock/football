import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { buildLineup } from '../src/dots/roster.js';
import { assignBlocks, doubleTeamPeel } from '../src/dots/blocking.js';
import { BODY_RADIUS, SPREAD, ENGAGE_TOL } from '../src/dots/blocking.js';
import { FIRST_STEP_LEN, RIDE_MIN } from '../src/dots/technique.js';
import { zoneSwitch, SWITCH_DIST } from '../src/dots/zone.js';

const DT = 1 / 60;
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
const targets = (play) => Object.fromEntries(OL.map((id) => [id, play.player(id).block?.target]));

test('F-12 #5: assignBlocks plan overrides one blocker, rest nearest; no plan unchanged', () => {
  const a = buildLineup(25, 'base');
  const b = buildLineup(25, 'base');
  const c = buildLineup(25, 'base');
  assignBlocks(a);
  assignBlocks(b, { C: 'LDE' });
  assignBlocks(c);
  assert.deepEqual(b.find((p) => p.id === 'C').block, { target: 'LDE', angle: 'straight', engaged: false, seq: null });
  for (const id of OL) {
    if (id === 'C') continue;
    assert.deepEqual(b.find((p) => p.id === id).block, a.find((p) => p.id === id).block, id);
  }
  assert.deepEqual(a.map((p) => p.block), c.map((p) => p.block));
});

test('F-12 #6: insideZone snap assigns zone targets and combos; base unchanged', () => {
  const play = createPlay(25, 'insideZone');
  assert.equal(play.retargetRule, zoneSwitch);
  assert.deepEqual(play.combos, []);
  assert.ok(play.snap());
  assert.deepEqual(targets(play), { C: 'RDT', LG: 'RDE', LT: 'RDE', RG: 'LDT', RT: 'LDT' });
  assert.deepEqual(play.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ]);
  play.reset();
  assert.deepEqual(play.combos, []);

  const base = createPlay(25);
  assert.equal(base.retargetRule, doubleTeamPeel);
  base.snap();
  const fresh = buildLineup(25, 'base');
  assignBlocks(fresh);
  assert.deepEqual(targets(base), Object.fromEntries(OL.map((id) => [id, fresh.find((p) => p.id === id).block.target])));
});

test('F-12 #7: shifted MLB: both combos switch to their watch; range gives MLB to RG', () => {
  // Measured (sim time, cap 2.0 s): WLB taken at 0.367 s (LG), MLB taken at 0.400 s (RG).
  const play = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) play.shiftLB(-1);
  play.snap();
  assert.deepEqual(play.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ]);
  const first = { MLB: null, WLB: null };
  let t = 0;
  while (t < 2.0) {
    play.step(DT);
    t += DT;
    for (const c of play.combos) {
      if (first[c.watch] === null && [c.owner, c.partner].some((id) => play.player(id).block.target === c.watch)) {
        first[c.watch] = t;
      }
    }
  }
  assert.ok(first.MLB !== null && Math.abs(first.MLB - 0.400) <= 0.1, `MLB switch at ${first.MLB}`);
  assert.ok(first.WLB !== null && Math.abs(first.WLB - 0.367) <= 0.1, `WLB switch at ${first.WLB}`);
  assert.equal(play.player('RG').block.target, 'MLB');
  assert.equal(play.player('RT').block.target, 'LDT');
  assert.deepEqual(new Set([play.player('LG').block.target, play.player('LT').block.target]), new Set(['WLB', 'RDE']));

  // Range: MLB within SWITCH_DIST of RG, laterally nearer RG than RT, clear of everyone else.
  const p2 = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) p2.shiftLB(-1);
  p2.snap();
  const RG = p2.player('RG');
  const RT = p2.player('RT');
  const MLB = p2.player('MLB');
  const spot = { x: RG.x + 0.3, y: RG.y + 1.0 };
  assert.ok(Math.hypot(spot.x - RG.x, spot.y - RG.y) < SWITCH_DIST);
  assert.ok(Math.abs(spot.x - RG.x) < Math.abs(spot.x - RT.x));
  for (const p of p2.players) {
    if (p.id !== 'MLB') assert.ok(Math.hypot(spot.x - p.x, spot.y - p.y) >= 2 * BODY_RADIUS, p.id);
  }
  Object.assign(MLB, spot);
  p2.step(DT);
  assert.equal(RG.block.target, 'MLB');
  assert.equal(RT.block.target, 'LDT');
});

test('F-12 #8: base insideZone combos switch; no OL targets LDE', () => {
  // Measured: final targets reached at 0.417 s (sim time, cap raised to 2.0 s); checked at +0.1 s.
  const MEASURED8 = 0.417;
  const play = createPlay(25, 'insideZone');
  play.snap();
  const seen = new Set();
  for (let t = 0; t < MEASURED8 + 0.1; t += DT) {
    play.step(DT);
    for (const id of OL) seen.add(play.player(id).block.target);
  }
  assert.equal(play.player('RG').block.target, 'MLB');
  assert.equal(play.player('RT').block.target, 'LDT');
  // Which of LG/LT takes the WLB follows zoneSwitch's laterally-closer rule and moved with F-15 soft contact.
  assert.deepEqual(new Set([play.player('LG').block.target, play.player('LT').block.target]), new Set(['WLB', 'RDE']));
  assert.ok(!seen.has('LDE'));
});

const deg = (r) => (r * 180) / Math.PI;

test('F-17 #2: first step angles', () => {
  const want = { LT: 30, LG: 60, C: 30, RG: 30, RT: 60 };
  const play = createPlay(25, 'insideZone');
  const pre = Object.fromEntries(OL.map((id) => [id, { x: play.player(id).x, y: play.player(id).y }]));
  play.snap();
  play.step(DT);
  const side = -1;
  for (const id of OL) {
    const p = play.player(id);
    const a = deg(Math.atan2(p.y - pre[id].y, side * (p.x - pre[id].x)));
    assert.ok(Math.abs(a - want[id]) <= 2, `${id} ${a}`);
  }
  const p2 = createPlay(25, 'insideZone');
  for (let i = 0; i < 4; i++) p2.shiftDL(-1);
  const r0 = { x: p2.player('RT').x, y: p2.player('RT').y };
  p2.snap();
  p2.step(DT);
  const RT = p2.player('RT');
  const a = deg(Math.atan2(RT.y - r0.y, side * (RT.x - r0.x)));
  assert.ok(Math.abs(a - 10) <= 2, `RT ${a}`);
});

test('F-17 #3: phases step then aim', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  for (const id of OL) assert.equal(play.player(id).block.foot.phase, 'step', id);
  const seenAim = new Set();
  for (let i = 0, t = 0; t < 0.25; i++, t += DT) {
    play.step(DT);
    for (const id of OL) {
      const b = play.player(id).block;
      if (!b.engaged && !seenAim.has(id) && b.foot.phase === 'aim') {
        seenAim.add(id);
        const f = b.foot;
        const p = play.player(id);
        assert.ok(Math.hypot(p.x - f.ox, p.y - f.oy) >= FIRST_STEP_LEN - 0.05, id);
      }
      if (seenAim.has(id)) assert.notEqual(b.foot.phase, 'step', id);
    }
  }
  for (const id of OL) {
    const b = play.player(id).block;
    assert.ok(b.engaged || b.foot.phase === 'aim', id);
  }
});

test('F-17 #4: RG and RT sit side by side on LDT', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  let found = false;
  for (let t = 0; t < 2 && !found; t += DT) {
    play.step(DT);
    const RG = play.player('RG');
    const RT = play.player('RT');
    if (RG.block.engaged && RT.block.engaged && RG.block.target === 'LDT' && RT.block.target === 'LDT') {
      found = true;
      assert.ok(Math.hypot(RG.x - RT.x, RG.y - RT.y) <= SPREAD + ENGAGE_TOL);
      assert.ok(Math.abs(RG.y - RT.y) <= BODY_RADIUS);
    }
  }
  assert.ok(found);
});

test('F-17 #5: push directions', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  let c = 0;
  let r = 0;
  for (let t = 0; t < 1.0; t += DT) {
    // The push is computed before defenders move this step, so compare against the pre-step spread.
    const dx = play.player('MLB').x - play.player('LDT').x;
    play.step(DT);
    const C = play.player('C');
    if (C.block.engaged && C.block.target === 'RDT' && C.block.foot.ride === 0 && C.block.foot.push) {
      c++;
      assert.ok(Math.abs(C.block.foot.push.x) < 1e-9 && Math.abs(C.block.foot.push.y - 1) < 1e-9);
    }
    for (const id of ['RG', 'RT']) {
      const b = play.player(id).block;
      if (b.engaged && b.target === 'LDT' && b.foot.ride === 0 && b.foot.push) {
        r++;
        assert.equal(Math.sign(b.foot.push.x), Math.sign(dx));
        assert.ok(deg(Math.acos(b.foot.push.y)) <= 30 + 1e-9);
      }
    }
  }
  assert.ok(c > 0 && r > 0);
});

test('F-17 #6: ride a sideways-moving defender', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  for (let i = 0; i < 300 && !(play.player('C').block.engaged && play.player('C').block.target === 'RDT'); i++) play.step(DT);
  const C = play.player('C');
  const RDT = play.player('RDT');
  assert.ok(C.block.engaged && C.block.target === 'RDT');
  for (let i = 0; i < 3; i++) {
    RDT.x += 0.02;
    play.step(DT);
  }
  assert.equal(C.block.foot.ride, 1);
  assert.ok(C.block.foot.push.x > 0);
  for (let i = 0; i < 3; i++) {
    const x0 = RDT.x;
    play.step(DT);
    const vx = (RDT.x - x0) / DT;
    assert.ok(C.block.foot.ride === 1 || vx < -RIDE_MIN, `ride ${C.block.foot.ride} vx ${vx}`);
  }
});

test('F-17 #7: RG climbs to MLB in aim phase', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  let hit = false;
  for (let t = 0; t < 2 && !hit; t += DT) {
    play.step(DT);
    const RG = play.player('RG');
    if (RG.block.target === 'MLB') {
      hit = true;
      assert.equal(RG.block.foot.tech, 'climb');
      assert.equal(RG.block.foot.phase, 'aim');
      assert.equal(RG.block.foot.watch, null);
    }
  }
  assert.ok(hit);
});

test('F-17 #8: unplanned plays have no foot', () => {
  const play = createPlay(25);
  play.snap();
  for (const p of play.players) assert.ok(!p.block || !Object.hasOwn(p.block, 'foot'), p.id);
});

test('F-17 #9: watch ids', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  assert.equal(play.player('RG').block.foot.watch, 'MLB');
  assert.equal(play.player('RT').block.foot.watch, 'MLB');
  assert.equal(play.player('C').block.foot.watch, null);
});
