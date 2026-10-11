import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { buildLineup, FRONTS, DL_ROLES } from '../src/dots/roster.js';
import { assignBlocks, doubleTeamPeel, isBlocker } from '../src/dots/blocking.js';
import { BODY_RADIUS, SPREAD, ENGAGE_TOL, CONTACT_DIST } from '../src/dots/blocking.js';
import { FIRST_STEP_LEN, RIDE_MIN, TECHNIQUES, driveDir, rotate, PUSH_TURN, BLIND_START, COMBO_LEAN } from '../src/dots/technique.js';
import { gapSpan, GOALS, FILL_DEPTH } from '../src/dots/defense.js';
import { zoneSwitch, pickClimber, zonePlan, SWITCH_DIST, COMBO_HOLD, dangerOf, claimedSet, unclaimedInReach, DANGER_MARGIN } from '../src/dots/zone.js';
import { GAP_DEPTH } from '../src/dots/carrier.js';
import { readFront } from '../src/dots/front.js';
import { FRONT_NAMES } from './fixtures/fronts.js';
import { TACKLE_DIST } from '../src/dots/tackle.js';
import { LB_MINUS6_RG_WATCH } from './fixtures/base-front.js';

const DT = 1 / 60;
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
// T-162: a combo's climber targets a live linebacker, not necessarily the plan watch: the combo has switched when a member targets anything but its DL.
const climbTarget = (play, c) => [c.owner, c.partner].map((id) => play.player(id).block?.target).find((t) => t != null && t !== c.target) ?? null;
const unswitched = (players, c) => [c.owner, c.partner].every((id) => players.find((q) => q.id === id)?.block?.target === c.target);
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
  assert.deepEqual(targets(play), { C: 'RDT', LG: 'RDT', LT: 'RDE', RG: 'LDT', RT: 'LDT' });
  assert.deepEqual(play.combos, [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
    { owner: 'C', partner: 'LG', target: 'RDT', watch: 'WLB' },
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
  // tackles off: the climb is a blocking rule; a shed DL's tackle must not end the play before it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  for (let i = 0; i < 6; i++) play.shiftLB(-1);
  play.snap();
  assert.equal(play.combos.length, 2);
  assert.deepEqual(play.combos.find((c) => c.owner === 'RT'), { owner: 'RT', partner: 'RG', target: 'LDT', watch: W });
  const lg = play.combos.find((c) => c.owner === 'C');
  assert.equal(lg.partner, 'LG');
  assert.equal(lg.target, 'RDT');
  assert.ok(lg.watch != null);
  const switched = () => play.combos.every((c) => climbTarget(play, c) != null);
  let t = 0;
  while (t < 4.0 && play.ball.phase !== 'dead' && !switched()) {
    play.step(DT);
    t += DT;
  }
  // A combo climbs only after its stayer has held the DL: the RG/RT combo may still be holding when the play ends.
  let climbed = 0;
  for (const c of play.combos) {
    const targets = new Set([c.owner, c.partner].map((id) => play.player(id).block.target));
    const live = climbTarget(play, c);
    if (live) {
      climbed++;
      assert.deepEqual(targets, new Set([live, c.target]), `${c.owner}/${c.partner} targets`);
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
  // T-152: the climber follows the gap the LB fits (his goal), not who he stands nearer; judge by pickClimber.
  const orig = p2.retargetRule;
  let want = null;
  p2.retargetRule = (players, ballPos, ctx) => {
    want = pickClimber(RT, RG, p2.player('LDT'), ctx.defGoals?.[W]?.x ?? lb.x, ctx.side).id;
    return orig(players, ballPos, ctx);
  };
  p2.step(DT);
  const other = want === 'RG' ? RT : RG;
  assert.equal(p2.player(want).block.target, W);
  assert.equal(other.block.target, 'LDT');
});

test('F-12 #8 / F-39: base insideZone combos switch; the backside end man is blocked unless spared', () => {
  // tackles off: the combo switch is a blocking rule; a tackle before COMBO_HOLD must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  const plan = zonePlan(play.players, play.numbers, 25);
  const edge = plan.front.edge;
  const end = plan.front.line.at(-1).id;
  play.snap();
  const seen = new Set([...OL, 'TE'].map((id) => play.player(id).block.target));
  const switched = () => play.combos.every((c) => climbTarget(play, c) != null);
  let t = 0;
  while (t < 4.0 && play.ball.phase !== 'dead' && !switched()) {
    play.step(DT);
    t += DT;
    for (const id of [...OL, 'TE']) seen.add(play.player(id).block.target);
  }
  assert.deepEqual(new Set([play.player('RG').block.target, play.player('RT').block.target]), new Set(['MLB', 'LDT']));
  // Which of LG/LT takes the WLB follows zoneSwitch's laterally-closer rule and moved with F-15 soft contact.
  assert.deepEqual(new Set([play.player('LG').block.target, play.player('LT').block.target]), new Set(['WLB', 'RDE']));
  assert.ok(edge);
  const endTgt = plan.front.defenders.find((d) => d.id === plan.blocks[end]);
  if (plan.techs[end].tech === 'climb' && endTgt && endTgt.level === 'second') assert.ok(plan.free.includes(edge));
  else assert.ok(seen.has(edge));
});

const deg = (r) => (r * 180) / Math.PI;

test('F-17 #2: first step angles', () => {
  const want = { LT: 45, LG: 60, C: 60, RG: 45, RT: 60, TE: 10 };
  const play = createPlay(25, 'insideZone');
  const plan = zonePlan(play.players, play.numbers, 25);
  // F-50 #2: the TE spares the end man and climbs when a backside LB would be free
  want.TE = plan.techs.TE.tech === 'climb' ? 60 : 10;
  const pre = Object.fromEntries([...OL, 'TE'].map((id) => [id, { x: play.player(id).x, y: play.player(id).y }]));
  play.snap();
  play.step(DT);
  const side = -1;
  for (const id of [...OL, 'TE']) {
    const p = play.player(id);
    const a = deg(Math.atan2(p.y - pre[id].y, side * (p.x - pre[id].x)));
    assert.ok(Math.abs(a - want[id]) <= 2, `${id} ${a}`);
  }
  // With the DL shifted out, RT is no longer the backside end lineman: he zone-blocks the end man in his
  // playside gap (45 degrees), and the uncovered TE combos with him (60 degrees).
  const p2 = createPlay(25, 'insideZone');
  for (let i = 0; i < 4; i++) p2.shiftDL(-1);
  const r0 = Object.fromEntries(['RT', 'TE'].map((id) => [id, { x: p2.player(id).x, y: p2.player(id).y }]));
  p2.snap();
  p2.step(DT);
  for (const [id, w] of [['RT', 45], ['TE', 60]]) {
    const p = p2.player(id);
    const a = deg(Math.atan2(p.y - r0[id].y, side * (p.x - r0[id].x)));
    assert.ok(Math.abs(a - w) <= 2, `${id} ${a}`);
  }
});

test('F-17 #3: phases step then aim', () => {
  // LT and RT reach aim unengaged at about 0.37 s with accel; C and RG engage at about 0.28 s; LG engages the 2i in front of him at about 0.37 s, before he is seen in aim.
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
        assert.ok(Math.hypot(p.x - f.ox, p.y - f.oy) >= (TECHNIQUES[f.tech].stepLen ?? FIRST_STEP_LEN) - 0.05, id);
      }
      if (seenAim.has(id)) assert.notEqual(b.foot.phase, 'step', id);
    }
  }
  for (const id of ['LT', 'RT']) assert.ok(seenAim.has(id), id);
  for (const id of OL) {
    const b = play.player(id).block;
    assert.ok(b.engaged || b.foot.phase === 'aim', id);
  }
});

test('F-17 #4: RG and RT sit side by side on LDT', () => {
  // F-3: restated after the combo row went 'playside' (both blockers share one base push from the first tick). RT now arrives at LDT with the pair 0.817 apart at the first both-engaged tick (0.23 s, max 0.81), so the pair is judged 0.1 s later, when they are hip to hip on LDT (0.33 s: distance 0.57, dy 0.12; settles at 0.56, dy 0). pins combo contact geometry, not timing; retargeting is off because the RG's combo switch to MLB (about 0.33 s) comes before RT reaches LDT with the tighter alignment, so the double team never forms. With retargeting off RG and RT both engage LDT (about 0.25 s and 0.37 s).
  const play = createPlay(25, 'insideZone', { accel: false });
  play.retargetRule = null;
  play.snap();
  let found = false;
  let first = null;
  for (let t = 0; t < 2 && !found; t += DT) {
    play.step(DT);
    const RG = play.player('RG');
    const RT = play.player('RT');
    if (RG.block.engaged && RT.block.engaged && RG.block.target === 'LDT' && RT.block.target === 'LDT') {
      if (first == null) first = t;
      if (t < first + 0.1) continue;
      found = true;
      assert.ok(Math.hypot(RG.x - RT.x, RG.y - RT.y) <= SPREAD + ENGAGE_TOL);
      assert.ok(Math.abs(RG.y - RT.y) <= BODY_RADIUS);
    }
  }
  assert.ok(found);
});

test('F-17 #5: push directions', () => {
  // Restated for F-3 (combo row drive 'playside'; was: toward the watch): a combo blocker's drive is back and playside, sign of drive.x equals ctx.side, angle from vertical equals COMBO_LEAN (30). Counted only when the push is settled (turned less than the rate cap) and base is the drive, so push = rotate(drive, ride).
  const play = createPlay(25, 'insideZone');
  let side = 0;
  const rule = play.retargetRule;
  play.retargetRule = (players, ballPos, ctx) => { side = ctx.side; return rule(players, ballPos, ctx); };
  play.snap();
  let c = 0;
  let r = 0;
  const pt = (p) => ({ x: p.x, y: p.y });
  const ang = (a, b) => deg(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
  const groups = [['RDT', ['C', 'LG']], ['LDT', ['RG', 'RT']]];
  for (let t = 0; t < 1.0; t += DT) {
    const pre = [];
    for (const [tid, ids] of groups) {
      for (const id of ids) {
        const b = play.player(id);
        const f = b.block.foot;
        pre.push({ id, tid, tgt: pt(play.player(tid)), watch: f?.watch ? pt(play.player(f.watch)) : null, me: pt(b), push: f?.push ? { ...f.push } : null });
      }
    }
    play.step(DT);
    for (const s of pre) {
      const b = play.player(s.id).block;
      const f = b.foot;
      if (!(b.engaged && b.target === s.tid && f && s.push && s.watch)) continue;
      if (Math.abs(ang(s.push, f.push)) >= deg(PUSH_TURN * DT) - 1e-6) continue;
      const drive = driveDir(f.tech, s.tgt, s.watch, side);
      const contact = { x: s.tgt.x - s.me.x, y: s.tgt.y - s.me.y };
      if (Math.abs(ang(drive, contact)) > BLIND_START) continue;
      if (s.tid === 'RDT') c++; else r++;
      const unrot = rotate(f.push, -f.ride);
      assert.ok(Math.abs(ang(unrot, drive)) <= 1, `${s.id} unrot vs drive ${ang(unrot, drive)}`);
      assert.equal(Math.sign(drive.x), side, s.id);
      assert.ok(Math.abs(deg(Math.acos(Math.min(1, drive.y))) - COMBO_LEAN) <= 1e-6, s.id);
    }
  }
  assert.ok(c > 0 && r > 0, `c ${c} r ${r}`);
});

test('F-17 #6: ride a sideways-moving defender', () => {
  // Restated for F-3: the base push is the playside drive (side -1 here: x -0.5, y 0.87; push starts x -0.84). A defender moving +x makes ride negative and turns the push toward +x past the drive (measured: ride -0.27 at 16 ticks, -0.42 settled, push.x -0.10 vs drive.x -0.5).
  const play = createPlay(25, 'insideZone');
  let side = 0;
  const rule = play.retargetRule;
  play.retargetRule = (players, ballPos, ctx) => { side = ctx.side; return rule(players, ballPos, ctx); };
  play.snap();
  for (let i = 0; i < 300 && !(play.player('C').block.engaged && play.player('C').block.target === 'RDT'); i++) play.step(DT);
  const C = play.player('C');
  const RDT = play.player('RDT');
  assert.ok(C.block.engaged && C.block.target === 'RDT');
  // footPush reads the target's vel from the previous pass, so inject it right before each step.
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    RDT.vel = { x: 1.2, y: 0 };
    play.step(DT);
    reached = C.block.foot.ride < 0 && C.block.foot.push.x > driveDir('combo', RDT, null, side).x;
  }
  assert.ok(reached, `ride ${C.block.foot.ride}`);
  for (let i = 0; i < 3; i++) {
    play.step(DT);
    assert.ok(C.block.foot.ride < 0 || RDT.vel.x < -RIDE_MIN, `ride ${C.block.foot.ride} vx ${RDT.vel.x}`);
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
  assert.equal(play.player('C').block.foot.watch, 'WLB');
  assert.equal(play.player('LG').block.foot.watch, 'WLB');
});

const ORDER = ['drop', 'flow', 'fill', 'pursue'];
const lbs = (play) => play.players.filter((p) => p.role === 'LB');

test('F-19 #6: defense is null until an insideZone snap; LBs and linemen have agents', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    assert.equal(play.defense, null, k);
    play.snap();
    assert.ok(play.defense, k);
    for (const lb of lbs(play)) assert.ok(play.defense.agents[lb.id], `${k} ${lb.id}`);
    const edge = readFront(play.players, play.numbers, 25).edge;
    if (edge != null) assert.equal(play.defense.agents[edge]?.assign.type, 'contain', `${k} ${edge}`);
    for (const p of play.players) if ((p.role === 'DE' || p.role === 'DT') && p.id !== edge) assert.equal(play.defense.agents[p.id]?.assign.type, 'attack', `${k} ${p.id}`);
    play.reset();
    assert.equal(play.defense, null, k);
  }
  const base = createPlay(25);
  assert.equal(base.defense, null);
  base.snap();
  assert.equal(base.defense, null);
});

test('F-33 #5: unblocked DL stay in their widened gap until pursue and keep off the QB', () => {
  let cases = 0;
  for (const k of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      const play = createPlay(25, 'insideZone', { front: k, personnel });
      play.snap();
      const free = Object.values(play.players).filter((p) => (p.role === 'DE' || p.role === 'DT')
        && !play.players.some((o) => isBlocker(o) && o.block?.target === p.id)).map((p) => p.id);
      if (free.length === 0) continue;
      cases++;
      const qb = play.player('QB');
      let handoff = false;
      const judgedIds = new Set();
      for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
        play.step(DT);
        if (play.run.carried) handoff = true;
        for (const id of free) {
          const e = play.defense.agents[id];
          const dl = play.player(id);
          // the contain edge is judged in contain-play.test.js, not against his fit gap
          if (e.state !== 'pursue' && e.behavior !== 'contain') {
            const sp = gapSpan(play.players, play.defense, e.fit);
            if (sp) {
              judgedIds.add(id);
              assert.ok(dl.x >= sp.lo - BODY_RADIUS && dl.x <= sp.hi + BODY_RADIUS, `${k} ${personnel} ${id} x ${dl.x} in ${sp.lo}..${sp.hi} t=${i}`);
            }
          }
          if (!handoff) assert.ok(Math.hypot(dl.x - qb.x, dl.y - qb.y) > CONTACT_DIST + BODY_RADIUS, `${k} ${personnel} ${id} at QB t=${i}`);
        }
      }
      // under the F-50 spare rule a free DL is normally the spared contain edge, judged in contain-play.test.js
      for (const id of free) {
        const contain = play.defense.agents[id].assign?.type === 'contain';
        assert.ok(contain || judgedIds.has(id), `${k} ${personnel} ${id} is free but neither the contain edge nor judged against his gap`);
      }
    }
  }
  assert.ok(cases > 0, 'no front/personnel leaves a DL unblocked');
});

test('F-19 #4: a dropping LB never moves toward the LOS, and stays upfield of the snap line until pursue', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    play.snap();
    const prevY = {};
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of lbs(play)) {
        const e = play.defense.agents[lb.id];
        if (e.state === 'drop' && play.blockersOf(lb.id).length === 0 && lb.id in prevY) {
          assert.ok(lb.y >= prevY[lb.id] - 1e-9, `${k} ${lb.id} drop y ${lb.y} < ${prevY[lb.id]}`);
        }
        prevY[lb.id] = e.state === 'drop' && play.blockersOf(lb.id).length === 0 ? lb.y : undefined;
        if (prevY[lb.id] === undefined) delete prevY[lb.id];
        if (e.state !== 'pursue') assert.ok(lb.y > 25, `${k} ${lb.id} y ${lb.y}`);
      }
    }
  }
});

test('F-19 #5: LB states run drop, flow, fill, pursue in order; fill goal lies in his lane', () => {
  for (const k of Object.keys(FRONTS)) {
    // tackles off: this test watches AI behavior past the point a tackle would end the play.
    const play = createPlay(25, 'insideZone', { front: k, tackles: false });
    play.snap();
    // the edge LB (odd34) plays contain, with its own states (covered in defense.test.js)
    const zoneLbs = lbs(play).filter((lb) => play.defense.agents[lb.id].behavior === 'zone');
    const seq = Object.fromEntries(zoneLbs.map((lb) => [lb.id, []]));
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of zoneLbs) {
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
      assert.equal(q[0], 'drop', `${k} ${id}`);
      assert.equal(q[q.length - 1], 'pursue', `${k} ${id} ${q}`);
      const idx = q.map((s) => ORDER.indexOf(s));
      for (let i = 1; i < idx.length; i++) assert.ok(idx[i] > idx[i - 1], `${k} ${id} ${q}`);
    }
    assert.ok(play.run.carried, `${k} handoff`);
  }
});

test('F-34 #4: every front, each LB commits to his own lane: committed x differ by 2 body radii', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    play.snap();
    const ids = lbs(play).map((lb) => lb.id);
    for (let i = 0; i < 120 && play.ball.phase !== 'dead' && !ids.every((id) => play.defense.committed[id]); i++) play.step(DT);
    for (const id of ids) assert.ok(play.defense.committed[id], `${k} ${id} committed`);
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const dx = Math.abs(play.defense.committed[ids[a]].x - play.defense.committed[ids[b]].x);
        assert.ok(dx >= 2 * BODY_RADIUS - 1e-9, `${k} ${ids[a]}/${ids[b]} lanes ${dx}`);
      }
    }
  }
});

test('F-34 #5: every front, an unengaged LB in drop, flow or fill stays out of the line', () => {
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k, tackles: false });
    play.snap();
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of lbs(play)) {
        const e = play.defense.agents[lb.id];
        if (!['drop', 'flow', 'fill'].includes(e.state) || play.blockersOf(lb.id).length > 0) continue;
        // A stand-up edge LB can line up shallower than the bound (odd34 PO at 1 yd): he must not go shallower than he started.
        const bound = Math.min(FILL_DEPTH - BODY_RADIUS, e.y0 - 25 - 0.05);
        assert.ok(lb.y - 25 >= bound, `${k} ${lb.id} ${e.state} depth ${lb.y - 25} at ${i}`);
      }
    }
  }
});

test('F-19 #8: the climber comes off when the watched LB has committed', () => {
  // F-47: the climber is picked by pickClimber (the blocker on the side of the LB's fit), judged on the switch tick.
  let checked = 0;
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    play.snap();
    const orig = play.retargetRule;
    let seen = null;
    play.retargetRule = (players, ballPos, ctx) => {
      const out = orig(players, ballPos, ctx);
      const byId = (id) => players.find((q) => q.id === id);
      seen = out.map((e) => {
        const c = ctx.combos.find((m) => (m.owner === e.blocker || m.partner === e.blocker) && unswitched(players, m));
        const fit = ctx.defGoals?.[e.target]?.x ?? byId(e.target).x;
        const want = pickClimber(byId(c.owner), byId(c.partner), byId(c.target), fit, ctx.side);
        return { blocker: e.blocker, want: want.id };
      });
      return out;
    };
    const done = new Set();
    for (let i = 0; i < 120; i++) {
      seen = null;
      play.step(DT);
      for (const r of seen ?? []) {
        assert.equal(r.blocker, r.want, `${k} taker`);
        checked++;
      }
      for (const c of play.combos) {
        const live = climbTarget(play, c);
        if (!live || done.has(c.target)) continue;
        done.add(c.target);
        assert.ok(play.defense.committed[live], `${k} ${live} committed`);
      }
    }
  }
  assert.ok(checked > 0);
});

const HOLD_OK = (x, target) => x.block?.target === target && x.block.engaged && (x.block.held ?? 0) >= COMBO_HOLD - 1e-9;
// T-152 gate: the stayer is engaged on the DL and one of the two had held him COMBO_HOLD. The climber's own
// hold vanishes once he retargets, so `best` is the larger hold seen on the previous tick.
const heldMax = (play, c) => Math.max(...[c.owner, c.partner].map((id) => {
  const b = play.player(id).block;
  return b?.target === c.target && b.engaged ? (b.held ?? 0) : 0;
}));
const stayerEngaged = (x, target) => x.block?.target === target && x.block.engaged;

test('T-92 #5: every front, the double never leaves the DL unblocked; partner climbs after the hold', () => {
  let switches = 0;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    const engagedOnce = new Set();
    const switched = new Set();
    const prevHeld = {};
    for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
      play.step(DT);
      for (const c of play.combos) {
        const key = c.target + c.watch;
        if (!engagedOnce.has(key) && [c.owner, c.partner].some((id) => { const b = play.player(id).block; return b?.engaged && b.target === c.target; })) engagedOnce.add(key);
        // A 'past' or 'shed' release ends the check: once the carrier is RELEASE_PAST upfield, or the DL has
        // won leverage (F-33), the blocker lets him go by design. A 'lost' release still fails the check.
        const released = [c.owner, c.partner].some((id) => { const b = play.player(id).block; return b?.target === c.target && (b.released === 'past' || b.released === 'shed'); });
        if (released) engagedOnce.delete(key);
        else if (engagedOnce.has(key)) assert.ok(play.blockersOf(c.target).length > 0, `${front} ${c.target} unblocked at ${i}`);
        if (!switched.has(key)) {
          const live = climbTarget(play, c);
          const climber = live && [c.owner, c.partner].find((id) => play.player(id).block?.target === live);
          if (climber) {
            switched.add(key);
            switches++;
            const other = play.player(climber === c.owner ? c.partner : c.owner);
            assert.ok(stayerEngaged(other, c.target), `${front} ${live} stayer engaged`);
            assert.ok((prevHeld[key] ?? 0) >= COMBO_HOLD - 1e-9, `${front} ${live} held ${prevHeld[key]}`);
          } else prevHeld[key] = heldMax(play, c);
        }
      }
    }
  }
  assert.ok(switches > 0);
});

test('T-92 #6: base: RG climbs to MLB and C/LG to WLB only after the partner held', () => {
  // tackles off: the climb is a blocking rule; a tackle before COMBO_HOLD must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  let rg = false;
  let wlb = false;
  const held = (a, b, target) => Math.max(...[a, b].map((id) => (stayerEngaged(play.player(id), target) ? play.player(id).block.held ?? 0 : 0)));
  let prevL = 0;
  let prevR = 0;
  for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    if (!rg && play.player('RG').block?.target === 'MLB') {
      rg = true;
      assert.ok(stayerEngaged(play.player('RT'), 'LDT'));
      assert.ok(prevL >= COMBO_HOLD - 1e-9, `LDT held ${prevL}`);
    } else if (!rg) prevL = held('RG', 'RT', 'LDT');
    if (!wlb) {
      const climber = ['C', 'LG'].find((id) => play.player(id).block?.target === 'WLB');
      if (climber) {
        wlb = true;
        assert.ok(stayerEngaged(play.player(climber === 'C' ? 'LG' : 'C'), 'RDT'));
        assert.ok(prevR >= COMBO_HOLD - 1e-9, `RDT held ${prevR}`);
      } else prevR = held('C', 'LG', 'RDT');
    }
  }
  assert.ok(rg && wlb);
});

test('F-33 #8: every front, an OL block released as shed frees the DL, who then moves toward the ball', (t) => {
  // Tackles off so the line has time to shed (since F-41 no DL sheds before the tackle with tackles on).
  // Only the first shed per front is judged: later sheds happen in the pile around an untackleable carrier.
  // Farthest reach from the shed spot is logged, not judged: a cutting carrier can leave a shed DL near his spot.
  // The check is movement toward the ball: his own displacement, projected on the line to the ball, over 0.5 s.
  const BAR = 1e-6;
  let sheds = 0;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front, tackles: false });
    play.snap();
    let lastI = -1;
    const prev = new Set();
    const events = [];
    for (let sec = 0, i = 0; sec < 4 && play.ball.phase !== 'dead'; sec += DT, i++) {
      play.step(DT);
      lastI = i;
      const now = new Set();
      for (const o of play.players) {
        if (o.team !== 'offense' || o.block?.released !== 'shed') continue;
        const key = o.id + '>' + o.block.target;
        now.add(key);
        const d = play.player(o.block.target);
        if (!prev.has(key) && DL_ROLES.includes(d.role) && events.length === 0) {
          const b = play.ballPosition();
          events.push({ i, id: d.id, x: d.x, y: d.y, px: d.x, py: d.y, close: 0, b0: Math.hypot(b.x - d.x, b.y - d.y) });
        }
      }
      prev.clear();
      for (const k of now) prev.add(k);
      for (const e of events) {
        if (e.i === i || e.i + 1 === i) e.free = e.free || play.player(e.id).react === null;
        // A tackle ending the play on the check tick leaves him no time to move: not checked (dead below).
        if (!e.done) {
          const d = play.player(e.id);
          const b = play.ballPosition();
          const ux = b.x - e.px;
          const uy = b.y - e.py;
          e.close += ((d.x - e.px) * ux + (d.y - e.py) * uy) / (Math.hypot(ux, uy) || 1);
          e.px = d.x;
          e.py = d.y;
          e.max = Math.max(e.max ?? 0, Math.hypot(d.x - e.x, d.y - e.y));
        }
        if (!e.done && i >= e.i + Math.round(0.5 / DT) && play.ball.phase !== 'dead') {
          e.done = true;
          const d = play.player(e.id);
          const b = play.ballPosition();
          // A freed DL within TACKLE_DIST of the carrier with no blocker on him could tackle (canTackle); tackles are off here only to give the line time to shed, so he has reached the ball.
          const held = Math.hypot(b.x - d.x, b.y - d.y) <= TACKLE_DIST + 1e-6;
          e.far = e.close >= BAR || held;
          t.diagnostic(`${front} ${e.id} shed ${(e.i * DT).toFixed(2)} s max ${e.max.toFixed(2)} ` +
            `close ${e.close.toFixed(3)} held ${held} ball ${e.b0.toFixed(2)} -> ${Math.hypot(b.x - d.x, b.y - d.y).toFixed(2)}`);
        }
      }
    }
    const dead = play.ball.phase === 'dead';
    for (const e of events) {
      sheds++;
      // A tackle ending the play on the shed tick leaves no later tick to free him (the sim stops stepping): not checked.
      if (!(dead && lastI <= e.i)) assert.ok(e.free, `${front} ${e.id} react null after shed`);
      if (e.done) assert.ok(e.far, `${front} ${e.id} moves toward the ball after the shed`);
      else assert.ok(dead, `${front} ${e.id} not checked 0.5 s later while play live`);
    }
  }
  assert.ok(sheds >= 1);
});

test('F-45 #1-#4: interior doubles on the 4-3 base', () => {
  for (const personnel of ['noTe', 'te']) {
    const play = createPlay(25, 'insideZone', { personnel });
    assert.ok(play.snap());
    assert.deepEqual(play.combos.find((c) => c.owner === 'C'), { owner: 'C', partner: 'LG', target: 'RDT', watch: 'WLB' }, personnel);
    assert.equal(play.player('LT').block.target, 'RDE', personnel);
    assert.deepEqual(OL.filter((id) => play.player(id).block.target === 'RDE'), ['LT'], personnel);
    for (const c of play.combos) assert.notEqual(play.player(c.target).role, 'DE', `${personnel} ${c.target}`);
  }
  for (const front of ['over43', 'walkedUp']) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    for (const c of play.combos) assert.equal(play.player(c.target).role, 'DT', `${front} ${c.target}`);
  }
  const expected = {
    under43: [{ owner: 'RG', partner: 'C', target: 'PN', watch: 'L2' }, { owner: 'LG', partner: 'LT', target: 'PE', watch: 'L1' }],
    backedOff: [{ owner: 'RG', partner: 'C', target: 'PN', watch: 'L2' }, { owner: 'LG', partner: 'LT', target: 'PE', watch: 'L1' }],
    odd34: [{ owner: 'RG', partner: 'C', target: 'N', watch: 'BI' }, { owner: 'LG', partner: 'LT', target: 'PE', watch: 'PI' }],
    over43: [{ owner: 'C', partner: 'LG', target: 'PT', watch: 'MIK' }],
    walkedUp: [{ owner: 'C', partner: 'LG', target: 'PT', watch: 'MIK' }],
    bear: [{ owner: 'RG', partner: 'C', target: 'N', watch: 'L1' }],
  };
  for (const [front, combos] of Object.entries(expected)) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    assert.deepEqual(play.combos, combos, front);
  }
});

test('F-45 #2: readFront cover windows: a 4i is on the tackle, a backside shade on C goes to RG', () => {
  const play = createPlay(25, 'insideZone');
  const side = Math.sign(play.player('LG').x - play.player('C').x);
  const u = (id) => side * (play.player(id).x - play.player('C').x);
  const cover = (id, du) => {
    const players = play.players.map((p) => ({ ...p }));
    const dl = players.find((p) => p.id === 'RDE');
    dl.x = play.player('C').x + side * (u(id) + du);
    return readFront(players, play.numbers, 25).covered;
  };
  assert.ok(cover('LT', -0.25).LT.includes('RDE'));
  assert.ok(cover('C', -0.25).RG.includes('RDE'));
});

test('F-45 #5: C and LG double the 2i; LT is alone on the end until the climb', () => {
  const play = createPlay(25, 'insideZone', { personnel: 'te', tackles: false });
  play.snap();
  const engaged = new Set();
  let switched = false;
  let prev = 0;
  for (let t = 0; t < 4 && play.ball.phase !== 'dead'; t += DT) {
    play.step(DT);
    const C = play.player('C');
    const LG = play.player('LG');
    for (const o of [C, LG]) if (o.block.engaged && o.block.target === 'RDT') engaged.add(o.id);
    if (!switched) {
      if (C.block.target === 'WLB' || LG.block.target === 'WLB') {
        switched = true;
        const other = C.block.target === 'WLB' ? LG : C;
        assert.ok(stayerEngaged(other, 'RDT'));
        assert.ok(prev >= COMBO_HOLD - 1e-9, `RDT held ${prev}`);
      } else {
        prev = Math.max(...[C, LG].map((o) => (stayerEngaged(o, 'RDT') ? o.block.held ?? 0 : 0)));
        const ids = play.blockersOf('RDE');
        assert.ok(ids.every((id) => id === 'LT'), `RDE blockers ${ids}`);
      }
    }
  }
  assert.deepEqual([...engaged].sort(), ['C', 'LG']);
  assert.ok(switched);
});

test('F-45 #6: inside zone opens with a short, steep zone step', () => {
  const shifts = { dlPlus4: ['shiftDL', 1, 4], dlMinus4: ['shiftDL', -1, 4], lbPlus6: ['shiftLB', 1, 6], lbMinus6: ['shiftLB', -1, 6] };
  const rows = [];
  const bad = [];
  for (const name of FRONT_NAMES) {
    const play = createPlay(25, 'insideZone', { tackles: false });
    if (name in shifts) {
      const [fn, dir, n] = shifts[name];
      for (let i = 0; i < n; i++) play[fn](dir);
    } else if (name !== 'base') play.setFront(name);
    play.snap();
    const start = Object.fromEntries(OL.map((id) => [id, { x: play.player(id).x, y: play.player(id).y, tech: play.player(id).block?.foot?.tech }]));
    // Each zone/combo OL's first step ends when its foot leaves 'step' or he engages, within 0.5 s.
    const ends = {};
    const todo = OL.filter((id) => start[id].tech === 'zone' || start[id].tech === 'combo');
    for (let i = 1; i <= 30 && Object.keys(ends).length < todo.length; i++) {
      play.step(DT);
      for (const id of todo) {
        if (ends[id]) continue;
        const p = play.player(id);
        const b = p.block;
        if (b?.foot?.phase !== 'step' || b.engaged) {
          const lat = -(p.x - start[id].x); // playside is -x in this play
          const up = p.y - start[id].y;
          ends[id] = { tick: i, lat, up, speed: p.speed, reach: Math.hypot(lat, up), ang: deg(Math.atan2(up, Math.abs(lat))) };
        }
      }
    }
    const cells = [];
    for (const id of OL) {
      const tech = start[id].tech;
      if (tech !== 'zone' && tech !== 'combo') {
        cells.push(`${id} ${tech ?? '-'} skip`);
        continue;
      }
      const e = ends[id];
      if (!e) {
        bad.push(`${name} ${id} ${tech} no step end within 0.5 s`);
        cells.push(`${id} ${tech} none`);
        continue;
      }
      const cap = TECHNIQUES[tech].stepLen + e.speed * DT;
      if (e.reach > cap) bad.push(`${name} ${id} ${tech} reach ${e.reach.toFixed(2)} > ${cap.toFixed(2)}`);
      if (e.ang < 40) bad.push(`${name} ${id} ${tech} angle ${e.ang.toFixed(1)} < 40`);
      cells.push(`${id} ${tech} t${e.tick} ${e.lat.toFixed(2)}/${e.up.toFixed(2)} ${e.ang.toFixed(1)}deg`);
    }
    rows.push(`${name.padEnd(9)} ${cells.join('  ')}`);
  }
  assert.equal(bad.length, 0, `${bad.join('\n')}\n(id tech tick lat/up angle, yd)\n${rows.join('\n')}`);
});

// The human's rule: "not a problem the mike is moving laterally to the ball carrier, not coming down field so he
// wouldn't really have a chance anyway. And thats ok - we aren't building with outcome driven, it's football
// realism driven. The blocks won't work 100% of the time." Changed: the combo must still climb a live LB within
// 2.0 s and, if it engages him, he must be met before the line. A climber that never engages passes only when the
// LB flowed (lateral travel from the climb tick to the window end beats his downhill travel); a passing miss is
// logged with t.diagnostic, a downhill LB that got past the line unmet fails.
const judgeClimb = (t, probe, front, c) => {
  const n = Math.round(2.0 / DT);
  const who = `${front} ${c.owner}/${c.partner}`;
  let climb = null; // the LB the climber switched to, on the climb tick, and where he was then
  let engaged = null;
  let end = null;
  for (let i = 1; i <= n && !engaged; i++) {
    probe.step(DT);
    if (!climb) {
      const live = climbTarget(probe, c);
      if (!live) continue;
      const lb = probe.player(live);
      climb = { live, t: i * DT, x0: lb.x, y0: lb.y };
    }
    const lb = probe.player(climb.live);
    end = lb;
    const hit = [c.owner, c.partner].some((id) => {
      const b = probe.player(id).block;
      return b && b.target === climb.live && b.engaged;
    });
    if (hit) engaged = { t: i * DT, y: lb.y };
  }
  assert.ok(climb, `${who} never climbed a linebacker within 2.0 s`);
  if (engaged) {
    assert.ok(engaged.y >= 25 + GAP_DEPTH, `${who} met ${climb.live} at ${engaged.t.toFixed(2)} s, y ${engaged.y}`);
    return;
  }
  const lateral = Math.abs(end.x - climb.x0);
  const downhill = climb.y0 - end.y;
  const travel = `${who} vs ${climb.live}: lateral ${lateral.toFixed(2)} yd, downhill ${downhill.toFixed(2)} yd, y at end ${end.y.toFixed(2)}`;
  assert.ok(lateral > downhill, `${travel}: no engage, and the LB came downhill past the line unmet`);
  t.diagnostic(`${travel}: missed, LB flowed laterally`);
};

const climbProbe = (t, front, c) => {
  const p = createPlay(25, 'insideZone', { personnel: 'te', accel: true, tackles: false, front });
  p.snap();
  judgeClimb(t, p, front, c);
};

const combosOf = (front) => {
  const p = createPlay(25, 'insideZone', { personnel: 'te', accel: true, tackles: false, front });
  p.snap();
  return p.combos;
};

test('R-62: base and bear, every combo climber engages his watch before the watch reaches the line', (t) => {
  for (const front of ['base', 'bear']) {
    let checked = 0;
    for (const c of combosOf(front)) {
      if (front === 'base' && c.watch === 'MLB') continue;
      checked++;
      climbProbe(t, front, c);
    }
    assert.ok(checked > 0, `${front}: no combo checked`);
  }
});

test('R-62 (base RT/RG on the MLB): the climber engages the MLB before he reaches the line', (t) => {
  const combos = combosOf('base').filter((c) => c.watch === 'MLB');
  assert.ok(combos.length > 0, 'base MLB combo exists');
  for (const c of combos) climbProbe(t, 'base', c);
});

test('R-64: every front, the climber on the switch tick is the blocker on the side of the fit', () => {
  let checked = 0;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { personnel: 'te', accel: true, tackles: false, front });
    play.snap();
    const orig = play.retargetRule;
    let seen = null;
    play.retargetRule = (players, ballPos, ctx) => {
      const out = orig(players, ballPos, ctx);
      seen = out.map((e) => {
        const c = ctx.combos.find((k) => (k.owner === e.blocker || k.partner === e.blocker) && unswitched(players, k));
        const byId = (id) => players.find((q) => q.id === id);
        const fit = ctx.defGoals?.[e.target]?.x ?? byId(e.target).x;
        const want = pickClimber(byId(c.owner), byId(c.partner), byId(c.target), fit, ctx.side);
        return { front, blocker: e.blocker, want: want.id };
      });
      return out;
    };
    for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
      seen = null;
      play.step(DT);
      for (const r of seen ?? []) {
        assert.equal(r.blocker, r.want, `${front} climber`);
        checked++;
      }
    }
  }
  assert.ok(checked > 0);
});

test('R-64: base, RG climbs to the MLB at or before 0.85 s', () => {
  const play = createPlay(25, 'insideZone', { personnel: 'te', accel: true, tackles: false, front: 'base' });
  play.snap();
  let t = null;
  for (let i = 1; i <= 240 && t == null; i++) {
    play.step(DT);
    if (play.player('RG').block?.target === 'MLB') t = i * DT;
  }
  assert.ok(t != null && t <= 0.85 + 1e-9, `RG switched at ${t}`);
});

test('T-162 (F-50 #5/#7): every front, a combo switches once, to the plan watch unless a clearly more dangerous unclaimed LB is in reach', () => {
  let switches = 0;
  const diffs = [];
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front, personnel: 'te', tackles: false });
    play.snap();
    const orig = play.retargetRule;
    let seen = null;
    play.retargetRule = (players, ballPos, ctx) => {
      const out = orig(players, ballPos, ctx);
      const claimed = claimedSet(players);
      seen = out.map((e) => {
        const c = ctx.combos.find((m) => (m.owner === e.blocker || m.partner === e.blocker) && unswitched(players, m));
        const o = players.find((q) => q.id === c.owner);
        const pp = players.find((q) => q.id === c.partner);
        const reach = unclaimedInReach(players, ballPos, ctx, claimed, (o.x + pp.x) / 2);
        const plan = players.find((q) => q.id === c.watch);
        return { c, e, plan, reach, ballPos, ctx };
      });
      return out;
    };
    const count = new Map();
    for (let i = 0; i < 120 && play.ball.phase !== 'dead'; i++) {
      seen = null;
      play.step(DT);
      for (const r of seen ?? []) {
        const key = r.c.target + r.c.owner;
        count.set(key, (count.get(key) ?? 0) + 1);
        switches++;
        if (r.e.target === r.c.watch) continue;
        diffs.push(`${front} ${r.c.owner}/${r.c.partner}: ${r.c.watch} -> ${r.e.target}`);
        // a different target needs a reason: plan watch claimed or absent, or beaten by more than the margin
        const planFree = r.plan && r.reach.includes(r.plan);
        const best = r.reach[0];
        assert.equal(r.e.target, best.id, `${front} most dangerous in reach`);
        if (planFree) assert.ok(dangerOf(r.plan, r.ballPos, r.ctx) - dangerOf(best, r.ballPos, r.ctx) > DANGER_MARGIN, `${front} margin`);
      }
    }
    for (const [k, n] of count) assert.ok(n <= 1, `${front} ${k} switched ${n} times`);
    // a combo that has switched is never retargeted again by the rule: each combo fired at most once while unswitched
    for (const c of play.combos) assert.ok(climbTarget(play, c) == null || [c.owner, c.partner].filter((id) => play.player(id).block.target !== c.target).length === 1, `${front} ${c.owner} one climber`);
  }
  assert.ok(switches > 0);
  void diffs;
});

test('F-3 #2: combo partners lean together', () => {
  // Partners agree from 0.1 s after both are engaged: a 'playside' push starts on the shared base (footPush), not on the contact line (which began C/LG about 80 degrees apart and took 0.35 s to converge).
  for (const front of Object.keys(FRONTS)) {
    for (const opts of [{}, { personnel: 'te' }]) {
      const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, ...opts });
      let side = 0;
      play.retargetRule = (players, ballPos, ctx) => { side = ctx.side; return []; };
      play.snap();
      const first = new Map();
      const seen = new Map();
      for (let i = 1; i <= Math.round(1.5 / DT); i++) {
        play.step(DT);
        const t = i * DT;
        play.combos.forEach((c, k) => {
          const bs = [c.owner, c.partner].map((id) => play.player(id).block);
          if (!bs.every((b) => b.target === c.target && b.engaged)) return;
          if (!first.has(k)) first.set(k, t);
          if (t < first.get(k) + 0.1) return;
          const [a, b] = bs.map((x) => x.foot.push);
          const tag = `${front} ${JSON.stringify(opts)} ${c.owner}/${c.partner} t ${t.toFixed(2)}`;
          for (const p of [a, b]) assert.ok(p.y > 0 && side * p.x > 0, `${tag} push ${p.x.toFixed(2)},${p.y.toFixed(2)} side ${side}`);
          const ang = Math.abs(deg(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)));
          assert.ok(ang <= 15, `${tag} angle ${ang.toFixed(1)}`);
          seen.set(k, true);
        });
      }
      play.combos.forEach((c, k) => assert.ok(seen.get(k), `${front} ${JSON.stringify(opts)} ${c.owner}/${c.partner} never both engaged`));
    }
  }
});
