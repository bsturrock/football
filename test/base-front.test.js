import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { POSITIONS, FRONTS, buildLineup } from '../src/dots/roster.js';

test('F-22 #1/#2: SLB row and base front', () => {
  const slb = POSITIONS.find((p) => p.id === 'SLB');
  assert.equal(slb.name, 'Strongside Linebacker');
  assert.equal(slb.team, 'defense');
  assert.equal(slb.role, 'LB');
  const mlb = POSITIONS.find((p) => p.id === 'MLB');
  assert.ok(slb.dx > mlb.dx);
  assert.equal(slb.dy, mlb.dy);
  assert.equal(slb.speed, 7.5);
  assert.equal(slb.strength, 0.5);
  assert.deepEqual(slb.def, { read: 0.5 });

  assert.deepEqual(
    FRONTS.base.defenders.map((d) => d.id),
    ['LDE', 'LDT', 'RDT', 'RDE', 'MLB', 'WLB', 'SLB'],
  );
  assert.equal(FRONTS.base.name, '4-3 Base');
  assert.equal(buildLineup(25, 'base').length, 14);

  for (const key of Object.keys(FRONTS)) {
    if (key === 'base') continue;
    for (const d of FRONTS[key].defenders.filter((p) => p.role === 'LB')) {
      assert.equal(d.speed, 7.5, `${key} ${d.id} speed`);
      assert.equal(d.strength, 0.5, `${key} ${d.id} strength`);
      assert.deepEqual(d.def, { read: 0.35 }, `${key} ${d.id} def`);
    }
  }
});

test('F-22 #6: base inside zone with SLB runs 3 s', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  const states = [];
  let t = 0;
  assert.doesNotThrow(() => {
    while (t < 3.0 - 1e-9) {
      play.step(1 / 60);
      t += 1 / 60;
      states.push(play.defense.agents.SLB.state);
    }
  });
  assert.equal(play.ball.holder, 'RB');
  assert.ok(states.some((s) => s !== 'read'), `SLB states: ${[...new Set(states)].join(',')}`);
});
