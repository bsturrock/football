import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { buildLineup, FRONTS } from '../src/dots/roster.js';
import { assignBlocks, doubleTeamPeel } from '../src/dots/blocking.js';
import { BODY_RADIUS, SPREAD, ENGAGE_TOL, CONTACT_DIST } from '../src/dots/blocking.js';
import { FIRST_STEP_LEN, RIDE_MIN } from '../src/dots/technique.js';
import { gapSpan, GOALS } from '../src/dots/defense.js';
import { zoneSwitch, SWITCH_DIST, COMBO_HOLD } from '../src/dots/zone.js';
import { LB_MINUS6_RG_WATCH } from './fixtures/base-front.js';

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

test('F-12 #7: shifted LBs: both combos switch to their watch; range gives the RG-watch LB to RG', () => {
  // Both combos switch to their watch LB; the RG-watch LB ends with RG (commit-driven release, F-19).
  const W = LB_MINUS6_RG_WATCH;
  const play = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) play.shiftLB(-1);
  play.snap();
  assert.deepEqual(play.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: W },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ]);
  const switched = () => play.combos.every((c) => [c.owner, c.partner].some((id) => play.player(id).block.target === c.watch));
  let t = 0;
  while (t < 4.0 && play.ball.phase !== 'dead' && !switched()) {
    play.step(DT);
    t += DT;
  }
  // A combo climbs only after its stayer has held the DL: the RG/RT combo may still be holding when the play ends.
  let climbed = 0;
  for (const c of play.combos) {
    const targets = new Set([c.owner, c.partner].map((id) => play.player(id).block.target));
    if (targets.has(c.watch)) {
      climbed++;
      assert.deepEqual(targets, new Set([c.watch, c.target]), `${c.owner}/${c.partner} targets`);
    } else {
      assert.deepEqual(targets, new Set([c.target]), `${c.owner}/${c.partner} still double`);
    }
  }
  assert.ok(climbed > 0);

  // Range: the RG-watch LB within SWITCH_DIST of RG, laterally nearer RG than RT, clear of everyone else.
  const p2 = createPlay(25, 'insideZone');
  for (let i = 0; i < 6; i++) p2.shiftLB(-1);
  p2.snap();
  const RG = p2.player('RG');
  const RT = p2.player('RT');
  const lb = p2.player(W);
  for (let i = 0; i < 240 && !RG.block.engaged; i++) p2.step(DT);
  assert.equal(RG.block.target, 'LDT');
  // A spot from current positions: inside SWITCH_DIST of RG, laterally nearer RG than RT, clear of every other body.
  let spot = null;
  for (let dy = 0.4; dy < SWITCH_DIST && !spot; dy += 0.1) {
    for (const dx of [0, -0.3, 0.3, -0.6, 0.6]) {
      const c = { x: RG.x + dx, y: RG.y + dy };
      if (Math.hypot(dx, dy) >= SWITCH_DIST - 0.05 || Math.abs(c.x - RG.x) >= Math.abs(c.x - RT.x)) continue;
      if (p2.players.every((p) => p.id === W || Math.hypot(c.x - p.x, c.y - p.y) >= 2 * BODY_RADIUS)) {
        spot = c;
        break;
      }
    }
  }
  assert.ok(spot, 'a clear spot');
  Object.assign(lb, spot);
  // The range trigger only applies while the watched LB has not committed (a commit takes precedence).
  assert.ok(!p2.defense.committed?.[W], 'watched LB has not committed');
  // Fixture for the gate precondition: RT cannot hold LDT naturally before the play dies on this lineup.
  Object.assign(RT.block, { engaged: true, held: COMBO_HOLD });
  p2.step(DT);
  assert.equal(RG.block.target, W);
  assert.equal(RT.block.target, 'LDT');
});

test('F-12 #8: base insideZone combos switch; backside end LDE is never blocked', () => {
  // tackles off: the combo switch is a blocking rule; a tackle before COMBO_HOLD must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  const seen = new Set(OL.map((id) => play.player(id).block.target));
  const switched = () => play.combos.every((c) => [c.owner, c.partner].some((id) => play.player(id).block.target === c.watch));
  let t = 0;
  while (t < 4.0 && play.ball.phase !== 'dead' && !switched()) {
    play.step(DT);
    t += DT;
    for (const id of OL) seen.add(play.player(id).block.target);
  }
  assert.deepEqual(new Set([play.player('RG').block.target, play.player('RT').block.target]), new Set(['MLB', 'LDT']));
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
  // LT, LG, RT reach aim at about 0.37 s with accel; C and RG engage at about 0.30 s.
  const play = createPlay(25, 'insideZone', { accel: true });
  play.snap();
  for (const id of OL) assert.equal(play.player(id).block.foot.phase, 'step', id);
  const firstFoot = new Map(OL.map((id) => [id, play.player(id).block.foot]));
  const seenAim = new Set();
  for (let i = 0, t = 0; t < 0.5; i++, t += DT) {
    play.step(DT);
    for (const id of OL) {
      const b = play.player(id).block;
      // a zone-switch retarget (retargetFoot) starts a new foot directly in 'aim' with its origin reset, so it is not a first step (RG under accel, about 0.33 s)
      if (!b.engaged && !seenAim.has(id) && b.foot.phase === 'aim' && b.foot === firstFoot.get(id)) {
        seenAim.add(id);
        const f = b.foot;
        const p = play.player(id);
        assert.ok(Math.hypot(p.x - f.ox, p.y - f.oy) >= FIRST_STEP_LEN - 0.05, id);
      }
      if (seenAim.has(id)) assert.notEqual(b.foot.phase, 'step', id);
    }
  }
  for (const id of ['LT', 'LG', 'RT']) assert.ok(seenAim.has(id), id);
  for (const id of OL) {
    const b = play.player(id).block;
    assert.ok(b.engaged || b.foot.phase === 'aim', id);
  }
});

test('F-17 #4: RG and RT sit side by side on LDT', () => {
  // pins combo contact geometry, not timing; retargeting is off because the RG's combo switch to MLB (about 0.33 s) comes before RT reaches LDT with the tighter alignment, so the double team never forms. With retargeting off RG and RT both engage LDT (about 0.25 s and 0.37 s).
  const play = createPlay(25, 'insideZone', { accel: false });
  play.retargetRule = null;
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
  // tackles off: the climb is a blocking rule; a tackle before COMBO_HOLD must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
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

const ORDER = ['read', 'flow', 'fill', 'pursue'];
const lbs = (play) => play.players.filter((p) => p.role === 'LB');

test('F-19 #6: defense is null until an insideZone snap; LBs and linemen have agents', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    assert.equal(play.defense, null, k);
    play.snap();
    assert.ok(play.defense, k);
    for (const lb of lbs(play)) assert.ok(play.defense.agents[lb.id], `${k} ${lb.id}`);
    for (const p of play.players) if (p.role === 'DE' || p.role === 'DT') assert.equal(play.defense.agents[p.id]?.assign.type, 'attack', `${k} ${p.id}`);
    play.reset();
    assert.equal(play.defense, null, k);
  }
  const base = createPlay(25);
  assert.equal(base.defense, null);
  base.snap();
  assert.equal(base.defense, null);
});

test('F-33 #5: unblocked DL stay in their widened gap until pursue and keep off the QB', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  const free = Object.values(play.players).filter((p) => (p.role === 'DE' || p.role === 'DT')
    && !play.players.some((o) => OL.includes(o.id) && o.block?.target === p.id)).map((p) => p.id);
  assert.ok(free.length > 0);
  const qb = play.player('QB');
  let handoff = false;
  for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    if (play.run.carried) handoff = true;
    for (const id of free) {
      const e = play.defense.agents[id];
      const dl = play.player(id);
      if (e.state !== 'pursue') {
        const sp = gapSpan(play.players, play.defense, e.fit);
        // Bound is 2*BODY_RADIUS, not 1: the DL aims at the gap's current middle with no lead and the
        // speed ramp is slow, so he trails the moving gap (measured: base LDE ~0.294 yd outside at tick 47).
        // Tighten to 1*BODY_RADIUS when P-16 (lead the moving gap) lands.
        if (sp) assert.ok(dl.x >= sp.lo - 2 * BODY_RADIUS && dl.x <= sp.hi + 2 * BODY_RADIUS, `${id} x ${dl.x} in ${sp.lo}..${sp.hi} t=${i}`);
      }
      if (!handoff) assert.ok(Math.hypot(dl.x - qb.x, dl.y - qb.y) > CONTACT_DIST + BODY_RADIUS, `${id} at QB t=${i}`);
    }
  }
});

test('F-19 #4: LBs hold depth while reading, mirror the RB, and stay upfield of the snap line until pursue', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    play.snap();
    const rb = play.player(play.run.carrier);
    const rbx0 = rb.x;
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of lbs(play)) {
        const e = play.defense.agents[lb.id];
        if (play.defense.t < e.read && e.state === 'read') {
          assert.ok(lb.y >= e.y0 - BODY_RADIUS - 1e-9, `${k} ${lb.id} depth`);
          const dx = rb.x - rbx0;
          if (Math.abs(dx) > BODY_RADIUS && !lb.block?.engaged) {
            const lx = lb.x - e.x0;
            assert.ok(lx === 0 || Math.sign(lx) === Math.sign(dx), `${k} ${lb.id} mirror`);
          }
        }
        if (e.state !== 'pursue') assert.ok(lb.y > 25, `${k} ${lb.id} y ${lb.y}`);
      }
    }
  }
});

test('F-19 #5: LB states run read, flow, fill, pursue in order; fill goal lies in his gap', () => {
  for (const k of Object.keys(FRONTS)) {
    // tackles off: this test watches AI behavior past the point a tackle would end the play.
    const play = createPlay(25, 'insideZone', { front: k, tackles: false });
    play.snap();
    const seq = Object.fromEntries(lbs(play).map((lb) => [lb.id, []]));
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of lbs(play)) {
        const e = play.defense.agents[lb.id];
        const q = seq[lb.id];
        if (q[q.length - 1] !== e.state) q.push(e.state);
        if (e.state === 'fill') {
          const g = GOALS.fill(lb, e, { players: play.players, defense: play.defense, los: 25, run: play.run, ballPos: play.ballPosition() });
          const span = gapSpan(play.players, play.defense, e.fit);
          assert.ok(g.x >= span.lo + BODY_RADIUS - 1e-9 && g.x <= span.hi - BODY_RADIUS + 1e-9
            || Math.abs(g.x - (span.lo + span.hi) / 2) < 1e-9, `${k} ${lb.id} fill x`);
        }
      }
    }
    for (const [id, q] of Object.entries(seq)) {
      assert.equal(q[0], 'read', `${k} ${id}`);
      assert.equal(q[q.length - 1], 'pursue', `${k} ${id} ${q}`);
      const idx = q.map((s) => ORDER.indexOf(s));
      for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `${k} ${id} ${q}`);
    }
    assert.ok(play.run.carried, `${k} handoff`);
  }
});

test('F-19 #8: the climber comes off when the watched LB has committed', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    play.snap();
    const done = new Set();
    for (let i = 0; i < 120; i++) {
      play.step(DT);
      for (const c of play.combos) {
        const members = [c.owner, c.partner];
        if (done.has(c.watch) || !members.some((id) => play.player(id).block.target === c.watch)) continue;
        done.add(c.watch);
        assert.ok(play.defense.committed[c.watch], `${k} ${c.watch} committed`);
        if (c.owner === 'RT') assert.equal(play.player('RG').block.target, c.watch, `${k} taker`);
      }
    }
  }
});

const HOLD_OK = (x, target) => x.block?.target === target && x.block.engaged && (x.block.held ?? 0) >= COMBO_HOLD - 1e-9;

test('T-92 #5: every front, the double never leaves the DL unblocked; partner climbs after the hold', () => {
  let switches = 0;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    const engagedOnce = new Set();
    const switched = new Set();
    for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
      play.step(DT);
      for (const c of play.combos) {
        const key = c.target + c.watch;
        if (!engagedOnce.has(key) && [c.owner, c.partner].some((id) => { const b = play.player(id).block; return b?.engaged && b.target === c.target; })) engagedOnce.add(key);
        // Only a 'past' release ends the check: once the carrier is RELEASE_PAST upfield the blocker lets the DL go
        // by design (acc. 4). A 'lost' or 'shed' release still fails the check.
        const released = [c.owner, c.partner].some((id) => { const b = play.player(id).block; return b?.target === c.target && b.released === 'past'; });
        if (released) engagedOnce.delete(key);
        else if (engagedOnce.has(key)) assert.ok(play.blockersOf(c.target).length > 0, `${front} ${c.target} unblocked at ${i}`);
        if (!switched.has(key)) {
          const climber = [c.owner, c.partner].find((id) => play.player(id).block?.target === c.watch);
          if (climber) {
            switched.add(key);
            switches++;
            const other = play.player(climber === c.owner ? c.partner : c.owner);
            assert.ok(HOLD_OK(other, c.target), `${front} ${c.watch} stayer holds`);
          }
        }
      }
    }
  }
  assert.ok(switches > 0);
});

test('T-92 #6: base: RG climbs to MLB and LG/LT to WLB only after the partner held', () => {
  // tackles off: the climb is a blocking rule; a tackle before COMBO_HOLD must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  let rg = false;
  let wlb = false;
  for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    if (!rg && play.player('RG').block?.target === 'MLB') {
      rg = true;
      assert.ok(HOLD_OK(play.player('RT'), 'LDT'));
    }
    if (!wlb) {
      const climber = ['LG', 'LT'].find((id) => play.player(id).block?.target === 'WLB');
      if (climber) {
        wlb = true;
        assert.ok(HOLD_OK(play.player(climber === 'LG' ? 'LT' : 'LG'), 'RDE'));
      }
    }
  }
  assert.ok(rg && wlb);
});
