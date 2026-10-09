import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { buildLineup } from '../src/dots/roster.js';
import { assignBlocks, doubleTeamPeel } from '../src/dots/blocking.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
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
  // Measured (sim time, cap 2.0 s): WLB taken at 0.350 s (LG), MLB taken at 0.383 s (RG).
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
  assert.ok(first.MLB !== null && Math.abs(first.MLB - 0.383) <= 0.1, `MLB switch at ${first.MLB}`);
  assert.ok(first.WLB !== null && Math.abs(first.WLB - 0.35) <= 0.1, `WLB switch at ${first.WLB}`);
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
  // Measured: final targets reached at 1.133 s (sim time, cap raised to 2.0 s); checked at +0.1 s.
  const MEASURED8 = 1.133;
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
