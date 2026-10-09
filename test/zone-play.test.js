import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { buildLineup } from '../src/dots/roster.js';
import { assignBlocks, doubleTeamPeel } from '../src/dots/blocking.js';
import { zoneSwitch } from '../src/dots/zone.js';

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

test('F-12 #7: shifted MLB: C takes MLB, LG keeps RDT; range gives MLB to LG', () => {
  // Measured switch time 0.333 s (sim time, cap raised to 2.0 s).
  const MEASURED7 = 0.333;
  const play = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) play.shiftLB(-1);
  play.snap();
  const C = play.player('C');
  const LG = play.player('LG');
  const MLB = play.player('MLB');
  let t = 0;
  let switchT = null;
  while (t < 2.0) {
    play.step(DT);
    t += DT;
    if (C.block.target === 'MLB' || LG.block.target === 'MLB') {
      switchT = t;
      break;
    }
  }
  assert.ok(switchT !== null, `cap hit; MLB at ${MLB.x},${MLB.y}`);
  assert.ok(Math.abs(switchT - MEASURED7) <= 0.1, `switch at ${switchT}`);
  assert.equal(C.block.target, 'MLB');
  assert.equal(LG.block.target, 'RDT');

  // Range: MLB shifted playside within SWITCH_DIST, LG is laterally nearer, one step is enough.
  const p2 = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) p2.shiftLB(-1);
  p2.snap();
  p2.player('MLB').x = -3.2;
  p2.player('MLB').y = 25.2;
  p2.step(DT);
  assert.equal(p2.player('LG').block.target, 'MLB');
  assert.equal(p2.player('C').block.target, 'RDT');
});

test('F-12 #8: base insideZone combos switch; no OL targets LDE', () => {
  // Measured: final targets reached at 1.150 s (sim time, cap raised to 2.0 s); checked at +0.1 s.
  const MEASURED8 = 1.150;
  const play = createPlay(25, 'insideZone');
  play.snap();
  const seen = new Set();
  for (let t = 0; t < MEASURED8 + 0.1; t += DT) {
    play.step(DT);
    for (const id of OL) seen.add(play.player(id).block.target);
  }
  assert.equal(play.player('RG').block.target, 'MLB');
  assert.equal(play.player('RT').block.target, 'LDT');
  assert.equal(play.player('LG').block.target, 'WLB');
  assert.equal(play.player('LT').block.target, 'RDE');
  assert.ok(!seen.has('LDE'));
});
