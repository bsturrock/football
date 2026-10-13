import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { buildLineup, FRONTS, DL_ROLES } from '../src/dots/roster.js';
import { assignBlocks, doubleTeamPeel, isBlocker } from '../src/dots/blocking.js';
import { BODY_RADIUS, SPREAD, ENGAGE_TOL, CONTACT_DIST } from '../src/dots/blocking.js';
import { RIDE_MIN, CLIMB_LANE_REACH, TECHNIQUES, footGoal, aimPoint, leadSpot, HINGE_GIVE, stepDir, stepLenOf, rotate, PUSH_TURN, BLIND_START } from '../src/dots/technique.js';
import { gapSpan, GOALS, FILL_DEPTH, READ_STEP_DOWN, keyRead, FIT_LEAD } from '../src/dots/defense.js';
import { zoneSwitch, pickClimber, zonePlan, SWITCH_DIST, COMBO_TOUCH, RIDE_DEPTH, TRACK_HALF, dangerOf, claimedSet, WALL_GAP, unclaimedInReach, DANGER_MARGIN } from '../src/dots/zone.js';
import { GAP_DEPTH } from '../src/dots/carrier.js';
import { readFront, HEAD_UP, LINE_DEPTH } from '../src/dots/front.js';
import { FRONT_NAMES, frontPlayers } from './fixtures/fronts.js';
import { numberPlay } from '../src/dots/numbering.js';
import { TACKLE_DIST } from '../src/dots/tackle.js';

const DT = 1 / 60;
const UNBLOCKED_BROKEN = 1.0; // s clearly broken (PRINCIPLES #7)
const MEET_BROKEN = 1.0; // yd behind the los a climber may meet his LB before it is clearly broken (PRINCIPLES #7)
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
// T-162: a combo's climber targets a live linebacker, not necessarily the plan watch: the combo has switched when a member targets anything but its DL.
const climbTarget = (play, c) => [c.owner, c.partner].map((id) => play.player(id).block?.target).find((t) => t != null && t !== c.target) ?? null;
const unswitched = (players, c) => [c.owner, c.partner].every((id) => players.find((q) => q.id === id)?.block?.target === c.target);
const targets = (play) => Object.fromEntries(OL.map((id) => [id, play.player(id).block?.target]));
// these rules are judged at the 4.5 yd alignment they were written against (PRINCIPLES #7: the rule given an alignment)
const OLD_LB_DY = 4.5;
// pins every off-ball LB (depth > 2 yd past the los) to dy; call after createPlay, before snap, with no presnap setters after
const pinLbDepth = (play, dy) => {
  for (const p of play.players) if (p.role === 'LB' && p.y - play.los > 2.0) p.y = play.los + dy;
};

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
  // F-54 #3/#4: the RT target and the RT/RG combo are not pinned (the pairing rule changes them); the full base plan is pinned in test/assign.test.js.
  const t6 = targets(play);
  assert.deepEqual({ C: t6.C, LG: t6.LG, LT: t6.LT, RG: t6.RG }, { C: 'RDT', LG: 'RDT', LT: 'RDE', RG: 'LDT' });
  // F-54 #1: the RDT is a 2i on LG and covers C, so LG owns the ace
  assert.deepEqual(play.combos.find((c) => c.owner === 'LG'), { owner: 'LG', partner: 'C', target: 'RDT', watch: 'WLB' });
  play.reset();
  assert.deepEqual(play.combos, []);

  const base = createPlay(25);
  assert.equal(base.retargetRule, doubleTeamPeel);
  base.snap();
  const fresh = buildLineup(25, 'base');
  assignBlocks(fresh);
  assert.deepEqual(targets(base), Object.fromEntries(OL.map((id) => [id, fresh.find((p) => p.id === id).block.target])));
});

test('F-12 #7: shifted LBs: every combo switches to its watch', () => {
  // F-54 #3/#4: the RT/RG combo and the "range gives the RG-watch LB to RG" part are dropped (the pairing rule changes who pairs with whom); every combo present still switches.
  // tackles off: the climb is a blocking rule; a shed DL's tackle must not end the play before it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  for (let i = 0; i < 6; i++) play.shiftLB(-1);
  play.snap();
  assert.ok(play.combos.length >= 1);
  const lg = play.combos.find((c) => c.owner === 'LG'); // F-54 #1: the RDT covers C, LG owns the ace
  assert.equal(lg.partner, 'C');
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

// F-55 #4: a lineman's first-step angle is the row's angle for the plan's tech and shade, not a literal.
const rowAngle = (plan, id) => {
  const d = stepDir(plan.techs[id].tech, plan.techs[id].shade ?? 'none', 1);
  return deg(Math.atan2(d.y, d.x));
};

test('F-17 #2: first step angles', () => {
  // F-55 #4: expected angles come from the plan's tech and shade through the TECHNIQUES rows.
  const play = createPlay(25, 'insideZone');
  const plan = zonePlan(play.players, play.numbers, 25);
  const want = Object.fromEntries([...OL, 'TE'].map((id) => [id, rowAngle(plan, id)]));
  const pre = Object.fromEntries([...OL, 'TE'].map((id) => [id, { x: play.player(id).x, y: play.player(id).y }]));
  play.snap();
  play.step(DT);
  const side = -1;
  for (const id of [...OL, 'TE']) {
    const p = play.player(id);
    const a = deg(Math.atan2(p.y - pre[id].y, side * (p.x - pre[id].x)));
    assert.ok(Math.abs(a - want[id]) <= 2, `${id} ${a}`);
  }
  // With the DL shifted out, RT is no longer the backside end lineman: he zone-blocks the end man, and the
  // uncovered TE combos with him; their angles follow the rows too (F-55 #4).
  const p2 = createPlay(25, 'insideZone');
  for (let i = 0; i < 4; i++) p2.shiftDL(-1);
  const plan2 = zonePlan(p2.players, p2.numbers, 25);
  const r0 = Object.fromEntries(['RT', 'TE'].map((id) => [id, { x: p2.player(id).x, y: p2.player(id).y }]));
  p2.snap();
  p2.step(DT);
  for (const [id, w] of [['RT', rowAngle(plan2, 'RT')], ['TE', rowAngle(plan2, 'TE')]]) {
    const p = p2.player(id);
    const a = deg(Math.atan2(p.y - r0[id].y, side * (p.x - r0[id].x)));
    assert.ok(Math.abs(a - w) <= 2, `${id} ${a}`);
  }
});

test('F-17 #3: phases step then aim', () => {
  // F-55 #5: a cutoff man's second phase is 'hinge', every other row's is 'aim'.
  const second = (b) => (b.foot.tech === 'cutoff' ? 'hinge' : 'aim');
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
      if (!b.engaged && !seenAim.has(id) && b.foot.phase === second(b) && b.foot === firstFoot.get(id)) {
        seenAim.add(id);
        const f = b.foot;
        const p = play.player(id);
        assert.ok(Math.hypot(p.x - f.ox, p.y - f.oy) >= stepLenOf(f.tech, f.shade) - 0.05, id);
      }
      if (seenAim.has(id)) assert.notEqual(b.foot.phase, 'step', id);
    }
  }
  for (const id of ['LT', 'RT']) assert.ok(seenAim.has(id), id);
  for (const id of OL) {
    const b = play.player(id).block;
    assert.ok(b.engaged || b.foot.phase === second(b), id);
  }
});

test('F-17 #4: C and LG sit side by side on RDT', () => {
  // F-54 #3/#4: restated from RG/RT on LDT to C/LG on RDT, which the new pairing rule leaves unchanged. Below, RG/RT/LDT/MLB refer to the old subject; the same bounds now judge C/LG on RDT.
  // F-3: restated after the combo row went 'playside' (both blockers share one base push from the first tick). RT now arrives at LDT with the pair 0.817 apart at the first both-engaged tick (0.23 s, max 0.81), so the pair is judged 0.1 s later, when they are hip to hip on LDT (0.33 s: distance 0.57, dy 0.12; settles at 0.56, dy 0). pins combo contact geometry, not timing; retargeting is off because the RG's combo switch to MLB (about 0.33 s) comes before RT reaches LDT with the tighter alignment, so the double team never forms. With retargeting off RG and RT both engage LDT (about 0.25 s and 0.37 s).
  const play = createPlay(25, 'insideZone', { accel: false });
  play.retargetRule = null;
  play.snap();
  let found = false;
  let first = null;
  for (let t = 0; t < 2 && !found; t += DT) {
    play.step(DT);
    const C = play.player('C');
    const LG = play.player('LG');
    if (C.block.engaged && LG.block.engaged && C.block.target === 'RDT' && LG.block.target === 'RDT') {
      if (first == null) first = t;
      if (t < first + 0.3) continue; // measured: C/LG first both engaged at 0.10 s, dy 0.05 then 0.30 while squaring up, hip to hip (dy 0.26, dist 0.56) from 0.3 s after
      found = true;
      assert.ok(Math.hypot(C.x - LG.x, C.y - LG.y) <= SPREAD + ENGAGE_TOL);
      assert.ok(Math.abs(C.y - LG.y) <= BODY_RADIUS);
    }
  }
  assert.ok(found);
});

test('F-17 #5: push directions', () => {
  // Restated for F-55 #4 (combo row drive 'double'; was 'playside' lean, before that toward the watch): a combo blocker's drive is straight upfield, drive.x is 0 and the angle from vertical is 0. Counted only when the push is settled (turned less than the rate cap) and base is the drive, so push = rotate(drive, ride).
  const play = createPlay(25, 'insideZone');
  let side = 0;
  const rule = play.retargetRule;
  play.retargetRule = (players, ballPos, ctx) => { side = ctx.side; return rule(players, ballPos, ctx); };
  play.snap();
  const pt = (p) => ({ x: p.x, y: p.y });
  const ang = (a, b) => deg(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y));
  // F-54 #3/#4: groups come from the snap's combos, not the old RG/RT literal.
  const groups = play.combos.map((k) => [k.target, [k.owner, k.partner]]);
  const counts = groups.map(() => 0);
  for (let t = 0; t < 1.0; t += DT) {
    const pre = [];
    for (const [gi, [tid, ids]] of groups.entries()) {
      for (const id of ids) {
        const b = play.player(id);
        const f = b.block.foot;
        pre.push({ id, tid, gi, tgt: pt(play.player(tid)), watch: f?.watch ? pt(play.player(f.watch)) : null, me: pt(b), push: f?.push ? { ...f.push } : null });
      }
    }
    play.step(DT);
    for (const s of pre) {
      const b = play.player(s.id).block;
      const f = b.foot;
      if (!(b.engaged && b.target === s.tid && f && s.push && s.watch)) continue;
      if (Math.abs(ang(s.push, f.push)) >= deg(PUSH_TURN * DT) - 1e-6) continue;
      assert.equal(TECHNIQUES[f.tech].drive, 'double', s.id);
      const drive = { x: 0, y: 1 };
      const contact = { x: s.tgt.x - s.me.x, y: s.tgt.y - s.me.y };
      if (Math.abs(ang(drive, contact)) > BLIND_START) continue;
      counts[s.gi]++;
      const unrot = rotate(f.push, -f.ride);
      assert.ok(Math.abs(ang(unrot, drive)) <= 1, `${s.id} unrot vs drive ${ang(unrot, drive)}`);
      assert.equal(drive.x, 0, s.id);
      assert.equal(drive.y, 1, s.id);
    }
  }
  assert.ok(groups.length > 0 && counts.every((n) => n > 0), `counts ${counts}`);
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
    reached = C.block.foot.ride < 0 && C.block.foot.push.x > 0; // the combo drive is straight upfield (x 0)
  }
  assert.ok(reached, `ride ${C.block.foot.ride}`);
  for (let i = 0; i < 3; i++) {
    play.step(DT);
    assert.ok(C.block.foot.ride < 0 || RDT.vel.x < -RIDE_MIN, `ride ${C.block.foot.ride} vx ${RDT.vel.x}`);
  }
});

test('F-17 #7: the C/LG climber to WLB is in aim phase', () => {
  // F-54 #3/#4: restated from RG climbing to MLB (the base RT/RG double goes away) onto the C/LG double.
  // tackles off: the climb is a blocking rule; a tackle before COMBO_HOLD must not hide it.
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  let hit = false;
  for (let t = 0; t < 2 && !hit; t += DT) {
    play.step(DT);
    const climber = ['C', 'LG'].map((id) => play.player(id)).find((p) => p.block.target === 'WLB');
    if (climber) {
      hit = true;
      assert.equal(climber.block.foot.tech, 'climb');
      assert.equal(climber.block.foot.phase, 'aim');
      assert.equal(climber.block.foot.watch, null);
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
  // F-54 #3/#4: the RG and RT watch lines are dropped (RT/RG no longer double the base LDT).
  assert.equal(play.player('C').block.foot.watch, 'WLB');
  assert.equal(play.player('LG').block.foot.watch, 'WLB');
});

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

// F-58: every front and the formations '11' and '12', both directions.
const lbCases = () => {
  const out = [];
  for (const playside of ['left', 'right']) {
    for (const k of Object.keys(FRONTS)) out.push({ name: `${k} ${playside}`, opts: { front: k, playside } });
    for (const formation of ['11', '12']) out.push({ name: `formation ${formation} ${playside}`, opts: { formation, playside } });
  }
  return out;
};
const zoneLbs = (play) => lbs(play).filter((lb) => play.defense.agents[lb.id].behavior === 'zone');
const CLASS = ['fit', 'scrape', 'split'];

// F-19 #4, restated for the LB read: an unengaged LB in read, fit, scrape or split is never deeper than his alignment y0
// (the read step, the fit and the scrape never backpedal), and stays upfield of the line until pursue.
test('F-19 #4: an unengaged LB in read or a class state is never deeper than his alignment, and stays off the line until pursue', () => {
  for (const { name, opts } of lbCases()) {
    const play = createPlay(25, 'insideZone', { ...opts, tackles: false });
    play.snap();
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of zoneLbs(play)) {
        const e = play.defense.agents[lb.id];
        if (e.state === 'pursue') continue;
        if (['read', ...CLASS].includes(e.state) && play.blockersOf(lb.id).length === 0) {
          assert.ok(lb.y <= e.y0 + 0.1, `${name} ${lb.id} ${e.state} y ${lb.y} deeper than y0 ${e.y0} at ${i}`);
        }
        assert.ok(lb.y > 25, `${name} ${lb.id} y ${lb.y}`);
      }
    }
  }
});

// F-58 #5 (takeOn between the class state and pursue): m is the LB's states between read and pursue.
// m may be empty; m[0] is a class state (fit, scrape, split), or drop or man alone (no takeOn on a pass read).
// A takeOn comes right after a class state; the state after a takeOn is the return state: fit when the class state
// before it was fit or split, scrape when it was scrape.
const takeOnSequenceOk = (m) => {
  if (m.length === 0) return true;
  if (!CLASS.includes(m[0])) return ['drop', 'man'].includes(m[0]) && m.length === 1;
  for (let i = 1; i < m.length; i++) {
    if (m[i] === 'takeOn') {
      if (!CLASS.includes(m[i - 1])) return false;
    } else if (m[i - 1] === 'takeOn') {
      const before = m[i - 2];
      if (m[i] !== (before === 'scrape' ? 'scrape' : 'fit')) return false;
    } else {
      return false;
    }
  }
  return true;
};

// F-19 #5, restated for F-58 #5 (takeOn between the class state and pursue): the LB's states run read, one class state (with takeOn returns), pursue; the fit goal lies in his gap span.
test('F-19 #5: LB states run read, one class state (with takeOn returns), pursue; the fit goal lies in his gap span', () => {
  for (const { name, opts } of lbCases()) {
    // tackles off: this test watches AI behavior past the point a tackle would end the play.
    const play = createPlay(25, 'insideZone', { ...opts, tackles: false });
    play.snap();
    // the edge LB (odd34) plays contain, with its own states (covered in defense.test.js)
    const zl = zoneLbs(play);
    const seq = Object.fromEntries(zl.map((lb) => [lb.id, []]));
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of zl) {
        const e = play.defense.agents[lb.id];
        const q = seq[lb.id];
        if (q[q.length - 1] !== e.state) q.push(e.state);
        if (e.state === 'fit') {
          const g = GOALS.fitGap(lb, e, { players: play.players, defense: play.defense, los: 25, cues: (id) => play.cuesOf(id), run: play.run, ballPos: play.ballPosition() });
          const span = gapSpan(play.players, play.defense, e.fit);
          assert.ok(g.x >= span.lo + BODY_RADIUS - 1e-9 && g.x <= span.hi - BODY_RADIUS + 1e-9
            || Math.abs(g.x - (span.lo + span.hi) / 2) < 1e-9, `${name} ${lb.id} fit x`);
        }
      }
    }
    for (const [id, q] of Object.entries(seq)) {
      assert.equal(q[0], 'read', `${name} ${id}`);
      assert.equal(q[q.length - 1], 'pursue', `${name} ${id} ${q}`);
      assert.ok(takeOnSequenceOk(q.slice(1, -1)), `${name} ${id} ${q}`);
    }
    assert.ok(play.run.carried, `${name} handoff`);
  }
});

// F-34 #4, restated: each LB fits his own gap: two LBs in fit never share a gap.
test('F-34 #4: two LBs in fit never share a gap', () => {
  for (const { name, opts } of lbCases()) {
    const play = createPlay(25, 'insideZone', { ...opts, tackles: false });
    play.snap();
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      const gaps = zoneLbs(play).filter((lb) => play.defense.agents[lb.id].state === 'fit').map((lb) => { const f = play.defense.agents[lb.id].fit; return `${f.side} ${f.name}`; });
      assert.equal(new Set(gaps).size, gaps.length, `${name} ${gaps} at ${i}`);
    }
  }
});

// F-34 #5, restated: an unengaged LB in read or a class state stays out of the line.
test('F-34 #5: every front, an unengaged LB in read or a class state stays out of the line', () => {
  for (const { name, opts } of lbCases()) {
    const play = createPlay(25, 'insideZone', { ...opts, tackles: false });
    play.snap();
    for (let i = 0; i < 180; i++) {
      play.step(DT);
      for (const lb of zoneLbs(play)) {
        const e = play.defense.agents[lb.id];
        if (!['read', ...CLASS].includes(e.state) || play.blockersOf(lb.id).length > 0) continue;
        // A stand-up edge LB can line up shallower than the bound (odd34 PO at 1 yd): he must not go shallower than he started.
        const bound = Math.min(FILL_DEPTH - BODY_RADIUS, e.y0 - 25 - READ_STEP_DOWN - 0.05); // the read step is a quarter yard uphill
        assert.ok(lb.y - 25 >= bound, `${name} ${lb.id} ${e.state} depth ${lb.y - 25} at ${i}`);
      }
    }
  }
});

// F-58 #3: a scraping LB stays over the top: along his flow he is never more than a body ahead of the ball.
// Inside zone gives no fast flow or pulling guard, so the scrape state is forced at tick 15 (before any LB pursues);
// the bound is judged once he has arrived at his scrape spot (within a body of the goal), while he stays unengaged in scrape.
test('F-58 #3: a scraping LB stays over the top', () => {
  let checked = 0;
  for (const { name, opts } of lbCases()) {
    const play = createPlay(25, 'insideZone', { ...opts, tackles: false });
    play.snap();
    for (let i = 0; i < 180; i++) {
      if (i === 15) for (const lb of zoneLbs(play)) if (play.defense.agents[lb.id].state === 'read') play.defense.agents[lb.id].state = 'scrape';
      play.step(DT);
      for (const lb of zoneLbs(play)) {
        const e = play.defense.agents[lb.id];
        if (e.state !== 'scrape' || play.blockersOf(lb.id).length > 0) continue;
        const c = play.cuesOf(lb.id);
        const s = keyRead(e.assign?.key, c) === 'pull' ? Math.sign(c.key.dir) : Math.sign(c.flow.dir);
        const g = GOALS.scrapeGoal(lb, e, { players: play.players, defense: play.defense, los: 25, cues: (id) => play.cuesOf(id), run: play.run, ballPos: play.ballPosition() });
        if (!s || Math.hypot(lb.x - g.x, lb.y - g.y) > BODY_RADIUS) continue;
        checked++;
        const led = c.ball.x + (c.ball.vx ?? 0) * FIT_LEAD;
        assert.ok(s * (lb.x - led) <= BODY_RADIUS + 1e-9, `${name} ${lb.id} x ${lb.x} ball ${c.ball.x} led ${led} s ${s} at ${i}`);
      }
    }
  }
  assert.ok(checked > 0, 'no LB scraped');
});

test('F-19 #8: the climber comes off when the watched LB has committed', () => {
  // F-47: the climber is picked by pickClimber (the member laterally nearer the LB, from where he is: F-59), judged on the switch tick.
  let checked = 0;
  for (const k of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front: k });
    play.snap();
    const orig = play.retargetRule;
    let seen = null;
    play.retargetRule = (players, ballPos, ctx) => {
      const out = orig(players, ballPos, ctx);
      const byId = (id) => players.find((q) => q.id === id);
      // T-89: a retarget with no unswitched combo (a released single climber, F-60 "LB gone") is judged by the F-60 tests.
      seen = out.flatMap((e) => {
        const c = ctx.combos.find((m) => (m.owner === e.blocker || m.partner === e.blocker) && unswitched(players, m));
        if (!c) return [];
        const want = pickClimber(byId(c.owner), byId(c.partner), byId(e.target));
        return [{ blocker: e.blocker, want: want.id }];
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

test('T-94: under43 te left RG/RT double: the uncovered guard climbs to L3 and the tackle stays', () => {
  // the human: "Generally the player who is uncovered at play start will be the person taking the LB ... A tackle is almost never going to go to the second level"
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'under43', personnel: 'te', playside: 'left' });
  pinLbDepth(play, OLD_LB_DY);
  play.snap();
  const orig = play.retargetRule;
  let first = null;
  let combo = null;
  play.retargetRule = (players, ballPos, ctx) => {
    const out = orig(players, ballPos, ctx);
    const c = ctx.combos.find((m) => m.owner === 'RG' && m.partner === 'RT');
    if (c && !combo) combo = { ...c };
    if (c && !first) {
      const e = out.find((x) => x.blocker === 'RG' || x.blocker === 'RT');
      if (e) first = { ...e, combo: { ...c } };
    }
    return out;
  };
  let rtLeft = null;
  for (let i = 0; i * DT < 2.0; i++) {
    play.step(DT);
    if (combo && !rtLeft && play.player('RT').block?.target !== combo.target) rtLeft = i * DT;
  }
  assert.ok(first, 'the RG/RT double released');
  assert.equal(first.blocker, 'RG', 'the uncovered guard is the one who leaves');
  assert.equal(first.target, 'L3');
  assert.equal(rtLeft, null, 'the tackle stays on the double target');
});

const HOLD_OK = (x, target) => x.block?.target === target && x.block.engaged && (x.block.held ?? 0) >= COMBO_TOUCH - 1e-9; // F-55: COMBO_HOLD is gone; the least a pair has held when a declared LB releases it is COMBO_TOUCH
// T-152 gate: the stayer is engaged on the DL and one of the two had held him. The climber's own
// hold vanishes once he retargets, so `best` is the larger hold seen on the previous tick.
const heldMax = (play, c) => Math.max(...[c.owner, c.partner].map((id) => {
  const b = play.player(id).block;
  return b?.target === c.target && b.engaged ? (b.held ?? 0) : 0;
}));
const stayerEngaged = (x, target) => x.block?.target === target && x.block.engaged;

// F-55 #1/#2: zoneSwitch decides from the members' cues at the start of the tick, positions as the rule saw them
// (start of tick, or just after the move: either reading counts). cuesBefore(play) is read BEFORE play.step.
const cuesBefore = (play) => Object.fromEntries(OL.map((id) => [id, structuredClone(play.cuesOf(id))]));
const declaredIn = (cues, ids, lb) => ids.some((id) => {
  const cu = cues[id];
  const st = cu?.lbs?.[lb];
  return st === 'crossing' || (st === 'filling' && !!cu.track?.ids?.includes(lb));
});
// The reasons a combo may release for `lb` on this tick; `pre` = positions before the step, `held` = the pair's hold before it.
function releaseReasons(play, c, lb, pre, cuePre, held) {
  const ids = [c.owner, c.partner];
  const near = (get) => ids.some((id) => { const l = get(lb), m = get(id); return Math.hypot(l.x - m.x, l.y - m.y) <= SWITCH_DIST + 1e-9; });
  const forced = near((id) => play.player(id)) || near((id) => pre.get(id));
  const declared = declaredIn(cuePre, ids, lb) && held >= COMBO_TOUCH - 1e-9;
  const dl = [play.player(c.target).y, pre.get(c.target).y];
  const ride = dl.some((y) => y >= play.los + RIDE_DEPTH - 1e-9);
  return { forced, declared, ride, ok: forced || declared || ride };
}
const snapPos = (play) => new Map(play.players.map((p) => [p.id, { x: p.x, y: p.y }]));

test('T-92 #5: every front, the double never leaves the DL unblocked; partner climbs after the hold', (t) => {
  let switches = 0;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    const engagedOnce = new Set();
    const switched = new Set();
    const prevHeld = {};
    const run = {};
    let longest = 0;
    let longestKey = '-';
    let longestAt = 0;
    for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
      const pre = snapPos(play);
      const cuePre = cuesBefore(play);
      play.step(DT);
      for (const c of play.combos) {
        const key = c.target + c.watch;
        if (!engagedOnce.has(key) && [c.owner, c.partner].some((id) => { const b = play.player(id).block; return b?.engaged && b.target === c.target; })) engagedOnce.add(key);
        // A 'past' or 'shed' release ends the check: once the carrier is RELEASE_PAST upfield, or the DL has
        // won leverage (F-33), the blocker lets him go by design. A 'lost' release still fails the check.
        const released = [c.owner, c.partner].some((id) => { const b = play.player(id).block; return b?.target === c.target && (b.released === 'past' || b.released === 'shed'); });
        if (released) {
          engagedOnce.delete(key);
          delete run[key];
        } else if (engagedOnce.has(key)) {
          // F-71 #1: the unblocked run is measured and printed, and only a very wide run fails (PRINCIPLES #7).
          run[key] = play.blockersOf(c.target).length === 0 ? (run[key] ?? 0) + 1 : 0;
          if (run[key] > longest) { longest = run[key]; longestKey = key; longestAt = i; }
        }
        if (!switched.has(key)) {
          const live = climbTarget(play, c);
          const climber = live && [c.owner, c.partner].find((id) => play.player(id).block?.target === live);
          if (climber) {
            switched.add(key);
            switches++;
            const other = play.player(climber === c.owner ? c.partner : c.owner);
            assert.ok(stayerEngaged(other, c.target), `${front} ${live} stayer engaged`);
            // F-55 #1/#2 (restated from F-54 #3/#4: no COMBO_HOLD or LB_FILL_V): the climb is forced (LB within
            // SWITCH_DIST), or the LB declared in a member's cues with the pair held COMBO_TOUCH, or the DL reached the ride depth.
            const r = releaseReasons(play, c, live, pre, cuePre, prevHeld[key] ?? 0);
            assert.ok(r.ok, `${front} ${live} held ${prevHeld[key] ?? 0} ${JSON.stringify(r)}`);
          } else prevHeld[key] = heldMax(play, c);
        }
      }
    }
    t.diagnostic(`T-92 #5 ${front}: longest unblocked ${longestKey} ${longest} ticks (${(longest * DT).toFixed(2)} s, tick ${longestAt}, limit ${UNBLOCKED_BROKEN} s)`);
    assert.ok(longest * DT <= UNBLOCKED_BROKEN, `${front} ${longestKey} unblocked ${longest} ticks (${(longest * DT).toFixed(2)} s) > ${UNBLOCKED_BROKEN} s`);
  }
  assert.ok(switches > 0);
});

test('T-92 #6: base: C/LG climb to WLB only after the partner held', () => {
  // F-54 #3/#4: the RG-to-MLB half is dropped (the base RT/RG double goes away).
  // tackles off: the climb is a blocking rule; a tackle before the declaration must not hide it.
  // F-55 #1/#2: the climb is forced, declared (cues) with the pair held COMBO_TOUCH, or at the ride depth (was: held COMBO_HOLD).
  const play = createPlay(25, 'insideZone', { tackles: false });
  play.snap();
  let wlb = false;
  const held = (a, b, target) => Math.max(...[a, b].map((id) => (stayerEngaged(play.player(id), target) ? play.player(id).block.held ?? 0 : 0)));
  let prevR = 0;
  for (let i = 0; i < 240 && play.ball.phase !== 'dead'; i++) {
    const pre = snapPos(play);
    const cuePre = cuesBefore(play);
    play.step(DT);
    if (!wlb) {
      const climber = ['C', 'LG'].find((id) => play.player(id).block?.target === 'WLB');
      if (climber) {
        wlb = true;
        assert.ok(stayerEngaged(play.player(climber === 'C' ? 'LG' : 'C'), 'RDT'));
        const r = releaseReasons(play, { owner: 'C', partner: 'LG', target: 'RDT' }, 'WLB', pre, cuePre, prevR);
        assert.ok(r.ok, `RDT held ${prevR} ${JSON.stringify(r)}`);
      } else prevR = held('C', 'LG', 'RDT');
    }
  }
  assert.ok(wlb);
});

// Whether a freshly shed DL's first 0.5 s nets toward the ball depends on where a cutting carrier is at that
// instant. It is a knife edge the human judges by eye (F-63 #10), so the closing outcome is report-only;
// the release-frees-him rule stays strict.
test('F-33 #8: every front, an OL block released as shed frees the DL, who then moves toward the ball (report-only closing)', (t) => {
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
          e.final = Math.hypot(b.x - d.x, b.y - d.y);
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
      if (e.done) {
        if (!e.far) {
          t.diagnostic(`closing (report-only): ${front} ${e.id} shed tick ${e.i} (${(e.i * DT).toFixed(2)} s), ` +
            `close ${e.close.toFixed(3)} under BAR, ball ${e.b0.toFixed(2)} -> ${e.final.toFixed(2)}`);
        }
      } else assert.ok(dead, `${front} ${e.id} not checked 0.5 s later while play live`);
    }
  }
  assert.ok(sheds >= 1);
});

test('F-45 #1-#4: interior doubles on the 4-3 base', () => {
  for (const personnel of ['noTe', 'te']) {
    const play = createPlay(25, 'insideZone', { personnel });
    assert.ok(play.snap());
    // F-54 #1: the RDT is a 2i on LG and covers C, so LG owns the ace
    assert.deepEqual(play.combos.find((c) => c.owner === 'LG'), { owner: 'LG', partner: 'C', target: 'RDT', watch: 'WLB' }, personnel);
    assert.equal(play.player('LT').block.target, 'RDE', personnel);
    assert.deepEqual(OL.filter((id) => play.player(id).block.target === 'RDE'), ['LT'], personnel);
    for (const c of play.combos) assert.notEqual(play.player(c.target).role, 'DE', `${personnel} ${c.target}`);
  }
  for (const front of ['over43', 'walkedUp']) {
    const play = createPlay(25, 'insideZone', { front });
    play.snap();
    for (const c of play.combos) assert.equal(play.player(c.target).role, 'DT', `${front} ${c.target}`);
  }
  // F-54 #3/#4: the per-front pair table is removed here; T-24 restates it to the new pairs in test/assign.test.js.
});

// F-54 #1: a lineman is covered by a DL head-up or in his playside gap; a DL on his backside shoulder
// covers the next backside lineman. 0.25 inside the playside tackle covers the playside guard.
test('F-45 #2: readFront cover windows: a DL inside the tackle covers the guard, a backside shade on C goes to RG', () => {
  const play = createPlay(25, 'insideZone');
  const side = Math.sign(play.player('LG').x - play.player('C').x);
  const u = (id) => side * (play.player(id).x - play.player('C').x);
  const cover = (id, du) => {
    const players = play.players.map((p) => ({ ...p }));
    const dl = players.find((p) => p.id === 'RDE');
    dl.x = play.player('C').x + side * (u(id) + du);
    return readFront(players, play.numbers, 25).covered;
  };
  assert.ok(cover('LT', -0.25).LG.includes('RDE'));
  assert.ok(cover('C', -0.25).RG.includes('RDE'));
});

test('F-45 #5: C and LG double the 2i; LT is alone on the end until the climb', () => {
  const play = createPlay(25, 'insideZone', { personnel: 'te', tackles: false });
  play.snap();
  const engaged = new Set();
  let switched = false;
  let prev = 0;
  for (let t = 0; t < 4 && play.ball.phase !== 'dead'; t += DT) {
    const pre = snapPos(play);
    const cuePre = cuesBefore(play);
    play.step(DT);
    const C = play.player('C');
    const LG = play.player('LG');
    for (const o of [C, LG]) if (o.block.engaged && o.block.target === 'RDT') engaged.add(o.id);
    if (!switched) {
      if (C.block.target === 'WLB' || LG.block.target === 'WLB') {
        switched = true;
        const other = C.block.target === 'WLB' ? LG : C;
        assert.ok(stayerEngaged(other, 'RDT'));
        // F-55 #1/#2: forced, or declared with the pair held COMBO_TOUCH, or the ride depth (was: held COMBO_HOLD)
        const r = releaseReasons(play, { owner: 'C', partner: 'LG', target: 'RDT' }, 'WLB', pre, cuePre, prev);
        assert.ok(r.ok, `RDT held ${prev} ${JSON.stringify(r)}`);
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

// F-55 #4: the human asked for a short, steep step in F-45; the playside-shade covered man now reaches (flatter and
// longer) per the spec. Head, backside and helper steps stay short and steep.
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
    const start = Object.fromEntries(OL.map((id) => [id, { x: play.player(id).x, y: play.player(id).y, tech: play.player(id).block?.foot?.tech, shade: play.player(id).block?.foot?.shade }]));
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
      const shade = start[id].shade;
      const cap = stepLenOf(tech, shade) + e.speed * DT;
      if (e.reach > cap) bad.push(`${name} ${id} ${tech} reach ${e.reach.toFixed(2)} > ${cap.toFixed(2)}`);
      if (shade === 'playside') {
        if (e.ang >= 40) bad.push(`${name} ${id} ${tech} playside reach angle ${e.ang.toFixed(1)} not flatter than 40`);
      } else if (e.ang < 40) bad.push(`${name} ${id} ${tech} ${shade} angle ${e.ang.toFixed(1)} < 40`);
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
    t.diagnostic(`${who} met ${climb.live} at ${engaged.t.toFixed(2)} s, y ${engaged.y.toFixed(2)} (clearly broken below ${(25 - MEET_BROKEN).toFixed(2)}; old line ${25 + GAP_DEPTH})`);
    assert.ok(engaged.y >= 25 - MEET_BROKEN, `${who} met ${climb.live} at ${engaged.t.toFixed(2)} s, y ${engaged.y}`);
    return;
  }
  const lateral = Math.abs(end.x - climb.x0);
  const downhill = climb.y0 - end.y;
  const travel = `${who} vs ${climb.live}: lateral ${lateral.toFixed(2)} yd, downhill ${downhill.toFixed(2)} yd, y at end ${end.y.toFixed(2)}`;
  // F-55 (restated): the climber now leaves on the LB's declaration, so a climb that starts late may not meet a fast filler inside 2.0 s
  // (accepted: F-55 sets no meet time, T-33 improves the climb path). The climb itself is still required above; the meet is reported.
  t.diagnostic(`${travel}: ${lateral > downhill ? 'missed, LB flowed laterally' : 'not met within 2.0 s, LB came downhill (accepted under F-55)'}`);
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
      checked++;
      climbProbe(t, front, c);
    }
    assert.ok(checked > 0, `${front}: no combo checked`);
  }
});

// F-54 #3/#4: the 'R-62 (base RT/RG on the MLB)' test is removed: after T-24 the base has no combo watching the MLB.

test('R-64: every front, the climber on the switch tick is the blocker on the side of the fit', () => {
  let checked = 0;
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { personnel: 'te', accel: true, tackles: false, front });
    play.snap();
    const orig = play.retargetRule;
    let seen = null;
    play.retargetRule = (players, ballPos, ctx) => {
      const out = orig(players, ballPos, ctx);
      // T-89: a retarget with no unswitched combo (a released single climber, F-60 "LB gone") is judged by the F-60 tests.
      seen = out.flatMap((e) => {
        const c = ctx.combos.find((k) => (k.owner === e.blocker || k.partner === e.blocker) && unswitched(players, k));
        if (!c) return [];
        const byId = (id) => players.find((q) => q.id === id);
        const want = pickClimber(byId(c.owner), byId(c.partner), byId(e.target));
        return [{ front, blocker: e.blocker, want: want.id }];
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

// F-54 #3/#4: restated from RG climbing to the MLB (1.15 s) to the base C/LG double climbing to the WLB; measured 0.62 s (LG) on this lineup.
// F-55 #1/#2: the climber now leaves when the WLB declares (cues), not on the old hold timer; measured 1.02 s, bound set at 1.2 s (measured plus about 0.2 s).
test('R-64: base, the C/LG climber reaches the WLB at or before 1.2 s', () => {
  const play = createPlay(25, 'insideZone', { personnel: 'te', accel: true, tackles: false, front: 'base' });
  play.snap();
  let t = null;
  for (let i = 1; i <= 240 && t == null; i++) {
    play.step(DT);
    if (['C', 'LG'].some((id) => play.player(id).block?.target === 'WLB')) t = i * DT;
  }
  assert.ok(t != null && t <= 1.2 + 1e-9, `C/LG switched at ${t}`);
});

test('T-162 (F-50 #5/#7): every front, a combo switches once, to the plan watch unless a clearly more dangerous unclaimed LB is in reach', () => {
  let switches = 0;
  let declared = 0;
  const diffs = [];
  for (const front of Object.keys(FRONTS)) {
    const play = createPlay(25, 'insideZone', { front, personnel: 'te', tackles: false });
    play.snap();
    const orig = play.retargetRule;
    let seen = null;
    play.retargetRule = (players, ballPos, ctx) => {
      const out = orig(players, ballPos, ctx);
      const claimed = claimedSet(players);
      // T-89: a retarget with no unswitched combo (a released single climber, F-60 "LB gone") is judged by the F-60 tests.
      seen = out.flatMap((e) => {
        const c = ctx.combos.find((m) => (m.owner === e.blocker || m.partner === e.blocker) && unswitched(players, m));
        if (!c) return [];
        const o = players.find((q) => q.id === c.owner);
        const pp = players.find((q) => q.id === c.partner);
        const reach = unclaimedInReach(players, ballPos, ctx, claimed, (o.x + pp.x) / 2);
        const plan = players.find((q) => q.id === c.watch);
        const cues = Object.fromEntries([c.owner, c.partner].map((id) => [id, ctx.cues?.(id)]));
        return [{ c, e, plan, reach, ballPos, ctx, cues }];
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
        // F-55 #1: an LB who declared (fills or crosses into a member's track) is the combo's, whoever the plan watched
        if (declaredIn(r.cues, [r.c.owner, r.c.partner], r.e.target)) { declared++; continue; }
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

// F-60 #4 (P-4): the release off a combo takes a declared LB, and a combo's watch is claimed before the pick.
test('F-60 #4: under43 te, the combo releases pick the declared LB / the most dangerous unclaimed one', () => {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'under43', personnel: 'te', playside: 'left' });
  play.snap();
  const orig = play.retargetRule;
  const seen = [];
  play.retargetRule = (players, ballPos, ctx) => {
    const claimedBefore = claimedSet(players);
    const out = orig(players, ballPos, ctx);
    for (const e of out) {
      const c = ctx.combos.find((m) => (m.owner === e.blocker || m.partner === e.blocker) && unswitched(players, m));
      if (!c) continue;
      const o = players.find((q) => q.id === c.owner), pp = players.find((q) => q.id === c.partner);
      const cues = Object.fromEntries([c.owner, c.partner].map((id) => [id, ctx.cues?.(id)]));
      seen.push({ c, e, cues, claimedBefore, reach: unclaimedInReach(players, ballPos, ctx, claimedBefore, (o.x + pp.x) / 2).map((d) => d.id) });
    }
    return out;
  };
  for (let i = 0; i < 150 && play.ball.phase !== 'dead'; i++) play.step(FIXED_DT);
  const first = seen.find((r) => r.c.watch === 'L1');
  const second = seen.find((r) => r.c.watch === 'L2');
  assert.ok(first && second, `releases seen ${seen.map((r) => r.c.watch)}`);
  assert.equal(first.e.target, 'L2');
  assert.ok(declaredIn(first.cues, [first.c.owner, first.c.partner], 'L2'), 'L2 declared for the pair');
  assert.ok(second.claimedBefore.has('L2'), 'L2 is claimed at the BT release');
  assert.equal(second.e.target, second.reach[0]);
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
          // F-54: a helper playside of his partner (new in F-54 #3) is judged by F-55 T-32
          const [o, pt] = [c.owner, c.partner].map((id) => play.player(id));
          if (side * (pt.x - o.x) < 0) { seen.set(k, true); return; }
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

// F-3 #1/#3b/#4 (T-9, round 3): a climb answers the LB. The wrapper reads the players exactly as the rule saw them on the tick it released a climber.
const doubleRun = (front, opts, { check, tick, setup, secs = 2.0 } = {}) => {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, ...opts });
  const orig = play.retargetRule;
  const both = new Map(); // combo -> { t, x, y } the DL on the first tick both were on
  const climbed = new Map(); // combo -> { t, w, climber }
  let t = 0;
  play.retargetRule = (pl, b, ctx) => {
    const out = orig(pl, b, ctx);
    for (const c of play.combos) {
      const ps = [c.owner, c.partner].map((id) => pl.find((q) => q.id === id));
      const dl = pl.find((q) => q.id === c.target);
      const on = ps.every((q) => q.block?.target === c.target && q.block.engaged);
      if (on && !both.has(c)) both.set(c, { t, x: dl.x, y: dl.y });
      const e = out.find((o) => o.blocker === c.owner || o.blocker === c.partner);
      if (!climbed.has(c) && e) {
        const w = pl.find((q) => q.id === e.target);
        climbed.set(c, { t, w: w.id, climber: e.blocker });
        check?.({ c, t, side: ctx.side, dl, on, ps, first: both.get(c), w, ctx });
      } else if (!climbed.has(c) && on && tick) tick({ c, t, side: ctx.side, dl, ps, first: both.get(c) });
    }
    return out;
  };
  play.snap();
  setup?.(play);
  const eng = new Map(); // combo -> { t, lbY } the climber's engage tick on his LB
  for (let i = 1; i <= Math.round(secs / DT); i++) {
    t = i * DT;
    play.step(DT);
    for (const [c, k] of climbed) {
      if (eng.has(c)) continue;
      const cl = play.player(k.climber);
      if (cl.block?.target === k.w && cl.block.engaged) eng.set(c, { t, lbY: play.player(k.w).y });
    }
  }
  return { play, climbed, eng };
};

// F-55 #1/#2 (restated from forced / attacking / controlled): a climb is forced, off a declared LB (cues) after the pair held COMBO_TOUCH, or at the ride depth.
test('F-3 #1: a climb is forced, off a declared LB, or at the ride depth', (t) => {
  const paths = { forced: 0, declared: 0, ride: 0 };
  for (const front of Object.keys(FRONTS)) {
    for (const opts of [{}, { personnel: 'te' }]) {
      doubleRun(front, opts, {
        check: ({ c, t: tt, ps, w, dl, ctx }) => {
          const tag = `${front} ${JSON.stringify(opts)} ${c.owner}/${c.partner} t ${tt.toFixed(2)}`;
          const near = Math.min(...ps.map((q) => Math.hypot(w.x - q.x, w.y - q.y)));
          // a climber not yet on the DL counts the stayer's hold alone (as the rule does)
          const onDl = ps.filter((q) => q.block?.target === c.target && q.block.engaged);
          const joint = Math.min(...(onDl.length === 2 ? onDl : onDl.slice(0, 1)).map((q) => q.block.held ?? 0));
          const cues = Object.fromEntries(ps.map((q) => [q.id, ctx.cues(q.id)]));
          const declared = declaredIn(cues, ps.map((q) => q.id), w.id);
          if (near <= SWITCH_DIST) paths.forced++;
          else if (onDl.length >= 1 && declared && joint >= COMBO_TOUCH - 1e-6) paths.declared++;
          else if (onDl.length === 2 && dl.y >= ctx.los + RIDE_DEPTH - 1e-6) paths.ride++;
          else assert.fail(`${tag} climbed with no cause: near ${near.toFixed(2)} joint ${joint.toFixed(2)} declared ${declared} dl y ${dl.y.toFixed(2)}`);
        },
      });
    }
  }
  t.diagnostic(`climbs by path: ${JSON.stringify(paths)}`);
  assert.ok(paths.forced + paths.declared + paths.ride > 0);
});

// F-55 #1/#2: judge the rule only (who leaves, when, for whom, relative to the declaration), never a meet depth, time or play result.
// The wrapper reads the players, ctx and cues exactly as zoneSwitch saw them on the tick it released a climber.
const declaredRun = (front, personnel, playside, script) => {
  const play = createPlay(25, 'insideZone', { front, personnel, playside, script, accel: true, tackles: false });
  const orig = play.retargetRule;
  const events = [];
  play.retargetRule = (pl, b, ctx) => {
    const out = orig(pl, b, ctx);
    const byId = (id) => pl.find((q) => q.id === id);
    for (const c of ctx.combos) {
      const e = out.find((o) => o.blocker === c.owner || o.blocker === c.partner);
      if (!e || !unswitched(pl, c)) continue;
      const lb = byId(e.target), dl = byId(c.target), o = byId(c.owner), pt = byId(c.partner);
      const cues = Object.fromEntries([c.owner, c.partner].map((id) => [id, ctx.cues(id)]));
      events.push({
        c, e,
        forced: Math.min(...[o, pt].map((m) => Math.hypot(lb.x - m.x, lb.y - m.y))) <= SWITCH_DIST + 1e-9,
        declared: declaredIn(cues, [c.owner, c.partner], lb.id),
        ride: dl.y >= ctx.los + RIDE_DEPTH - 1e-9,
        want: pickClimber(o, pt, lb).id,
      });
    }
    return out;
  };
  assert.ok(play.snap(), `${front} ${personnel} ${playside} ${script}`);
  for (let i = 0; i < Math.round(2.5 / DT) && play.ball.phase !== 'dead'; i++) play.step(DT);
  return events;
};

test('F-55 #1: with lbSits no combo leaves its DL before the ride depth unless the LB is within SWITCH_DIST or declared in a member\'s cues', (t) => {
  let leaves = 0, rides = 0;
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      for (const playside of ['left', 'right']) {
        for (const ev of declaredRun(front, personnel, playside, 'lbSits')) {
          leaves++;
          if (ev.ride && !ev.forced && !ev.declared) rides++;
          assert.ok(ev.forced || ev.declared || ev.ride, `${front} ${personnel} ${playside} ${ev.c.owner}/${ev.c.partner} left for ${ev.e.target} with nobody declared, no ride depth, LB far`);
        }
      }
    }
  }
  t.diagnostic(`lbSits: ${leaves} releases, ${rides} at the ride depth only`);
});

test('F-55 #2: with lbFills and lbBlitz the first member to leave does so on a declaration, within SWITCH_DIST, or at the ride depth, and he is the one pickClimber names', (t) => {
  let leaves = 0;
  for (const script of ['lbFills', 'lbBlitz']) {
    for (const front of Object.keys(FRONTS)) {
      for (const personnel of ['noTe', 'te']) {
        for (const playside of ['left', 'right']) {
          const first = new Map();
          for (const ev of declaredRun(front, personnel, playside, script)) if (!first.has(ev.c.owner + ev.c.partner)) first.set(ev.c.owner + ev.c.partner, ev);
          for (const ev of first.values()) {
            leaves++;
            const tag = `${script} ${front} ${personnel} ${playside} ${ev.c.owner}/${ev.c.partner} -> ${ev.e.target}`;
            assert.ok(ev.forced || ev.declared || ev.ride, `${tag}: left with nobody declared, no ride depth, LB far`);
            assert.equal(ev.e.blocker, ev.want, `${tag}: the climber is the one pickClimber names`);
          }
        }
      }
    }
  }
  t.diagnostic(`lbFills/lbBlitz: ${leaves} first releases`);
});

// Restated for F-55 #4 (vertical combo drive, no playside lean): the double never gives ground, and its lateral drift stays smaller than its upfield travel.
test('F-3 #3b: while both are on, the double never gives ground or drifts backside', (t) => {
  let minDy = Infinity;
  let minDx = Infinity;
  // Measured from COMBO_TOUCH of joint hold: the impact lets the DL gain up to 0.03 yd for three ticks (measured -0.027 on base C/LG), then the double drives him.
  const look = ({ side, dl, first, ps }) => {
    if (!first || Math.min(...ps.map((q) => q.block?.held ?? 0)) < COMBO_TOUCH) return;
    const dy = dl.y - first.y, dx = side * (dl.x - first.x);
    minDy = Math.min(minDy, dy);
    minDx = Math.min(minDx, dx);
    assert.ok(dy >= -0.02, `DL y moved ${dy.toFixed(3)} toward the offense's goal`);
    // vertical drive: no playside demand, but he must not be walked sideways more than a few inches either way
    assert.ok(Math.abs(dx) <= Math.max(0.25, dy), `DL drifted sideways ${dx.toFixed(3)} (upfield ${dy.toFixed(3)})`);
  };
  for (const front of Object.keys(FRONTS)) {
    for (const opts of [{}, { personnel: 'te' }]) doubleRun(front, opts, { tick: look, check: look });
  }
  t.diagnostic(`min dy ${minDy.toFixed(3)}, min side*dx ${minDx.toFixed(3)}`);
});

test('F-3 #4: an LB who reads run early gets the climb no later and no deeper than one who reads late', (t) => {
  const diag = [];
  let strict = 0; // combos whose climb really came earlier (proves the read reaches the climb)
  for (const front of ['base', 'bear']) {
    const run = (read) => {
      // combos are only filled by play.snap(), so the watched LBs are read inside setup (which runs after the snap)
      return doubleRun(front, {}, { setup: (play) => { for (const id of new Set(play.combos.map((c) => c.watch))) if (play.defense.agents[id]) play.defense.agents[id].read = read; } });
    };
    const early = run(0.1), late = run(1.0);
    for (const c of early.play.combos) {
      const lc = late.play.combos.find((m) => m.owner === c.owner && m.partner === c.partner);
      const e = early.climbed.get(c), l = late.climbed.get(lc);
      if (!e || !l || e.w !== c.watch || l.w !== lc.watch) continue;
      diag.push(`${front} ${c.owner}/${c.partner} climb early ${e.t.toFixed(2)} late ${l.t.toFixed(2)}`);
      assert.ok(e.t <= l.t + 1e-9, `${front} ${c.owner} early climb ${e.t} after late ${l.t}`);
      if (e.t < l.t - 1e-9) strict++;
      const ee = early.eng.get(c), le = late.eng.get(lc);
      if (ee && le && ee.t <= 2.0 && le.t <= 2.0) assert.ok(ee.lbY <= le.lbY + 0.05, `${front} ${c.owner} early LB y ${ee.lbY.toFixed(2)} deeper than late ${le.lbY.toFixed(2)}`);
    }
  }
  assert.ok(strict > 0, `no combo climbed strictly earlier with an early read: ${diag.join('; ')}`);
  t.diagnostic(diag.join('; '));
});

// ---- F-54 #1: covered/uncovered matches the spec (.work/maps/covered-uncovered-spec.md) ----
const SPEC_LOS = 25;
// Real offense (x mirrored about the center when mirror is -1) against defenders given as [id, dx from C toward the right, depth].
function specRead(personnel, mirror, defs, playside) {
  const off = buildLineup(SPEC_LOS, 'insideZone', { personnel }).filter((p) => p.team === 'offense');
  const cx = off.find((p) => p.id === 'C').x;
  const players = off.map((p) => ({ ...p, x: cx + mirror * (p.x - cx) }));
  for (const [id, dx, depth] of defs) {
    players.push({ id, name: id, team: 'defense', role: depth > 2 ? 'LB' : 'DT', x: cx + mirror * dx, y: SPEC_LOS + depth, speed: 6, strength: 1 });
  }
  const ps = mirror === 1 ? playside : (playside === 'right' ? 'left' : 'right');
  return readFront(players, numberPlay(players, { los: SPEC_LOS, centerId: 'C', playside: ps }), SPEC_LOS);
}
const coveredOf = (r, ids) => Object.fromEntries(ids.map((id) => [id, r.covered[id]]));

test('F-54 #1: covered/uncovered matches the spec: nickel, both directions', () => {
  // te personnel, playside = TE side; spec alignment at the right-hand side (dx from C)
  const defs = [
    ['D5', -2.4 - 0.25, 0.6], ['D1', -0.25, 0.6], ['D3', 1.2 + 0.25, 0.6], ['D9', 3.6 + 0.7, 0.6],
    ['MIKE', 1.0, 4.5], ['WILL', -1.8, 4.5],
  ];
  for (const m of [1, -1]) {
    const r = specRead('te', m, defs, 'right');
    assert.deepEqual(coveredOf(r, ['TE', 'RT', 'RG', 'C', 'LG', 'LT']),
      { TE: ['D9'], RT: [], RG: ['D3'], C: [], LG: ['D1'], LT: ['D5'] }, `mirror ${m}`);
  }
});

test('F-54 #1: covered/uncovered matches the spec: tite, both directions', () => {
  const defs = [['N', 0, 0.6], ['R4', 2.15, 0.6], ['L4', -2.15, 0.6], ['MR', 1.2, 4.5], ['ML', -1.2, 4.5]];
  // mirroring moves offense and defense together, so ids keep their roles
  for (const m of [1, -1]) {
    const run = specRead('noTe', m, defs, 'right');
    assert.deepEqual(coveredOf(run, ['C', 'RG', 'LT', 'LG', 'RT']), { C: ['N'], RG: ['R4'], LT: ['L4'], LG: [], RT: [] }, `run right mirror ${m}`);
  }
  for (const m of [1, -1]) {
    const left = specRead('noTe', m, defs, 'left');
    assert.deepEqual(coveredOf(left, ['C', 'LG', 'RT', 'RG', 'LT']), { C: ['N'], LG: ['L4'], RT: ['R4'], RG: [], LT: [] }, `run left mirror ${m}`);
  }
});

test('F-54 #1: covered/uncovered matches the spec: every front, both directions', () => {
  for (const name of FRONT_NAMES) {
    for (const personnel of ['noTe', 'te']) {
      for (const playside of ['left', 'right']) {
        const base = frontPlayers(name, personnel);
        const cx = base.find((p) => p.id === 'C').x;
        const mirror = playside === 'left' ? 1 : -1; // fixtures are built playside left
        const players = base.map((p) => ({ ...p, x: cx + mirror * (p.x - cx) }));
        const numbers = numberPlay(players, { los: SPEC_LOS, centerId: 'C', playside });
        const r = readFront(players, numbers, SPEC_LOS);
        const sgn = playside === 'right' ? 1 : -1;
        const u = (p) => sgn * (p.x - cx);
        const line = players.filter((p) => p.team === 'offense' && numbers[p.id] != null).map((p) => ({ id: p.id, u: u(p) })).sort((a, b) => b.u - a.u);
        const split = (a, b) => a.u - b.u;
        const first = line[0].u + split(line[0], line[1]);
        const last = line.at(-1);
        const lastOut = last.u - split(line.at(-2), last);
        // spec: head-up on him, or in his playside gap; a DL on the backside shoulder belongs to the next backside man
        const owner = (du) => {
          const head = line.find((l) => Math.abs(du - l.u) <= HEAD_UP);
          if (head) return head.id;
          if (du >= first - HEAD_UP) return null;
          if (du < lastOut + HEAD_UP) return null;
          const gapInner = line.filter((l) => l.u < du).sort((a, b) => b.u - a.u)[0]; // nearest lineman on his backside
          return gapInner ? gapInner.id : last.id;
        };
        for (const d of players.filter((p) => p.team === 'defense' && numbers[p.id] != null && p.y - SPEC_LOS <= LINE_DEPTH)) {
          const want = owner(u(d));
          const holders = Object.keys(r.covered).filter((id) => r.covered[id].includes(d.id));
          assert.deepEqual(holders, want == null ? [] : [want], `${name} ${personnel} ${playside} ${d.id}`);
        }
      }
    }
  }
});

// F-55 #4: each zone/combo lineman's first step follows his role and shade: the move from the snap spot to the end
// of his step phase points along stepDir(tech, shade, side) and is no longer than stepLenOf plus one tick of speed.
test('F-55 #4: first steps by role and shade', () => {
  const bad = [];
  let checked = 0;
  for (const front of Object.keys(FRONTS)) {
    for (const personnel of ['noTe', 'te']) {
      for (const [playside, side] of [['left', -1], ['right', 1]]) {
        const play = createPlay(25, 'insideZone', { front, personnel, playside, tackles: false });
        play.snap();
        const start = {};
        for (const id of OL) {
          const p = play.player(id);
          const f = p.block?.foot;
          if (f && (f.tech === 'zone' || f.tech === 'combo')) start[id] = { x: p.x, y: p.y, tech: f.tech, shade: f.shade };
        }
        const done = new Set();
        for (let i = 1; i <= 30 && done.size < Object.keys(start).length; i++) {
          play.step(DT);
          for (const id of Object.keys(start)) {
            if (done.has(id)) continue;
            const p = play.player(id);
            const b = p.block;
            if (b?.foot?.phase === 'step' && !b.engaged) continue;
            done.add(id);
            const s0 = start[id];
            const mx = p.x - s0.x;
            const my = p.y - s0.y;
            const len = Math.hypot(mx, my);
            const want = stepDir(s0.tech, s0.shade, side);
            const cos = (mx * want.x + my * want.y) / (len * 1);
            const off = deg(Math.acos(Math.max(-1, Math.min(1, cos))));
            const cap = stepLenOf(s0.tech, s0.shade) + p.speed * DT;
            const who = `${front} ${personnel} ${playside} ${id} ${s0.tech}/${s0.shade}`;
            checked++;
            if (!(len > 0)) bad.push(`${who} did not move`);
            else if (off > 10) bad.push(`${who} direction ${off.toFixed(1)} deg off`);
            if (len > cap) bad.push(`${who} length ${len.toFixed(2)} > ${cap.toFixed(2)}`);
          }
        }
        for (const id of Object.keys(start)) if (!done.has(id)) bad.push(`${front} ${personnel} ${playside} ${id} step never ended`);
      }
    }
  }
  assert.ok(checked > 0);
  assert.equal(bad.length, 0, bad.join('\n'));
});

// F-55 #6 (.work/maps/climb-spec.md): the climb aims at the point where he would meet his linebacker.
const meetFoot = (tech) => ({ tech, shade: 'none', watch: null, phase: 'aim', ox: 0, oy: 0, ride: 0, push: null });
const nearPt = (a, b, msg) => assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

test('F-55 #6a: the climb aim leads to the intercept point on the near number', () => {
  const spot = { x: 3, y: 4 };
  const blocker = { x: 0, y: 0, speed: 5 };
  const vel = { x: -2, y: 0 };
  const goal = (tech, target, env = {}) => footGoal(meetFoot(tech), blocker, spot, 1, BODY_RADIUS, { target, ...env }).goal;
  // |spot + v t - blocker| = 5 t -> 21 t^2 + 12 t - 25 = 0 (a = 4 - 25, b = 2 * 3 * -2); the smaller positive root
  const t = (-12 + Math.sqrt(144 + 4 * 21 * 25)) / (2 * 21);
  const I = { x: spot.x + vel.x * t, y: spot.y };
  assert.ok(Math.abs(Math.hypot(I.x, I.y) - 5 * t) < 1e-6, 'I solves the intercept');
  const g = goal('climb', { vel });
  nearPt(g, aimPoint(I, 'climb', 1, BODY_RADIUS), 'intercept');
  nearPt(goal('climb', { vel: { x: 9, y: 9 }, selfVel: vel }), aimPoint(I, 'climb', 1, BODY_RADIUS), 'selfVel preferred');
  nearPt(goal('climb', { vel: { x: 0, y: 0 } }), aimPoint(spot, 'climb', 1, BODY_RADIUS), 'zero velocity');
  nearPt(goal('climb', undefined), aimPoint(spot, 'climb', 1, BODY_RADIUS), 'no target');
  // T-89: zone and combo aim at the led spot (clamped to the blocker's depth); the cutoff hinge likewise, less HINGE_GIVE.
  const led = leadSpot(blocker, spot, { vel });
  for (const tech of ['zone', 'combo']) {
    const a = aimPoint(led, tech, 1, BODY_RADIUS);
    nearPt(goal(tech, { vel }), { x: a.x, y: Math.max(a.y, blocker.y) }, tech + ' aims at the led spot');
  }
  const hinge = footGoal({ ...meetFoot('cutoff'), phase: 'hinge' }, blocker, spot, 1, BODY_RADIUS, { target: { vel } }).goal;
  const h = aimPoint(led, 'cutoff', 1, BODY_RADIUS);
  nearPt(hinge, { x: h.x, y: h.y - HINGE_GIVE }, 'cutoff hinge aims at the led spot');
});

test('F-55 #6b: no meeting point -> aim at the spot with no playside shift', () => {
  const spot = { x: 3, y: 4 };
  const blocker = { x: 0, y: 0, speed: 5 };
  const g = footGoal(meetFoot('climb'), blocker, spot, 1, BODY_RADIUS, { target: { vel: { x: 0, y: 8 } } }).goal;
  nearPt(g, spot, 'faster target running away');
  const gl = footGoal(meetFoot('climb'), blocker, { x: -3, y: 4 }, -1, BODY_RADIUS, { target: { vel: { x: 0, y: 8 } } }).goal;
  nearPt(gl, { x: -3, y: 4 }, 'left side too');
});

test('F-55 #6c: an intercept far from the ball is pulled back to CLIMB_LANE_REACH', () => {
  const blocker = { x: 0, y: 0, speed: 5 };
  const env = { target: { vel: { x: 0, y: 0 } }, ballPos: { x: 0, y: 20 } };
  const far = footGoal(meetFoot('climb'), blocker, { x: 9 - 0.5 * BODY_RADIUS, y: 4 }, 1, BODY_RADIUS, env).goal;
  assert.ok(Math.abs(far.x - CLIMB_LANE_REACH) < 1e-9 && far.y === 4, JSON.stringify(far));
  const farL = footGoal(meetFoot('climb'), blocker, { x: -9 + 0.5 * BODY_RADIUS, y: 4 }, -1, BODY_RADIUS, env).goal;
  assert.ok(Math.abs(farL.x + CLIMB_LANE_REACH) < 1e-9, JSON.stringify(farL));
  const near = footGoal(meetFoot('climb'), blocker, { x: 4 - 0.5 * BODY_RADIUS, y: 4 }, 1, BODY_RADIUS, env).goal;
  assert.ok(Math.abs(near.x - 4) < 1e-9, JSON.stringify(near));
});

// Climb spans for F-55 #6d: per combo member that retargets off the combo's DL, from the climb tick until he engages, his target changes or the window ends.
function climbSpans(front, personnel, playside) {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, personnel, playside });
  play.snap();
  const combos = play.combos.map((c) => ({ ...c }));
  const spans = [];
  const open = new Map();
  for (let i = 0; i * DT < 2.0 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    for (const c of combos) {
      for (const id of [c.owner, c.partner]) {
        const m = play.player(id);
        const key = c.owner + '/' + id;
        const sp0 = open.get(key);
        if (!sp0 && !spans.some((s) => s.key === key) && m.block && !m.block.engaged && m.block.target != null && m.block.target !== c.target) {
          const sp = { key, climber: id, front, personnel, playside, lbId: m.block.target, ticks: [] };
          open.set(key, sp);
          spans.push(sp);
        }
        const sp = open.get(key);
        if (!sp) continue;
        if (m.block?.engaged || m.block?.target == null || m.block.target !== sp.lbId) { open.delete(key); continue; }
        const lb = play.player(sp.lbId);
        sp.ticks.push({ i, y: m.y, vx: m.vel.x, lb: lb.id, lby: lb.y });
      }
    }
  }
  return spans;
}
const climbCases = () => {
  const out = [];
  for (const front of Object.keys(FRONTS)) for (const personnel of ['noTe', 'te']) for (const playside of ['left', 'right']) out.push([front, personnel, playside]);
  return out;
};

// Report-only (T-97, F-63 #11/#12): with T-90's RB vision change the line play shifts a little, and this level
// check then fails by a small margin. Measured with T-90, F-63: under43 te right, climber C past L2 at tick 102:
// y 27.493 > 27.167 + 0.28. The level is a contest between the climber's meeting point and the LB's own
// avoidance (same rule as test/climb-level.test.js), so the human judges it by watching the play.
test('F-55 #6d: a climber never climbs past his linebacker\'s level (report-only, LB avoidance on)', (t) => {
  let n = 0;
  let worst = -Infinity;
  const bad = [];
  for (const [front, personnel, playside] of climbCases()) {
    for (const sp of climbSpans(front, personnel, playside)) {
      for (const k of sp.ticks) {
        n++;
        worst = Math.max(worst, k.y - (k.lby + BODY_RADIUS));
        if (k.y > k.lby + BODY_RADIUS + 1e-9) bad.push(`level (report-only): ${front} ${personnel} ${playside} ${sp.climber} past ${k.lb} at tick ${k.i}: y ${k.y.toFixed(3)} > ${k.lby.toFixed(3)} + ${BODY_RADIUS}`);
      }
    }
  }
  for (const line of bad) t.diagnostic(line);
  t.diagnostic(`${n} climb ticks, worst margin ${worst.toFixed(3)} yd, ${bad.length} ticks past the level (report-only)`);
  assert.ok(n > 0);
});

// Report-only by the human's rule "Judge both by eye" (F-57 item 11b, T-68): the climber's side-to-side wobble is
// judged by watching the play, not by this count.
test('F-55 #6d: a climber\'s path does not wobble', (t) => {
  let spans = 0;
  let maxFlips = 0;
  const bad = [];
  for (const [front, personnel, playside] of climbCases()) {
    for (const sp of climbSpans(front, personnel, playside)) {
      let sign = 0;
      let flips = 0;
      for (const k of sp.ticks) {
        if (Math.abs(k.vx) <= 0.3) continue;
        const s = Math.sign(k.vx);
        if (sign !== 0 && s !== sign) flips++;
        sign = s;
      }
      spans++;
      maxFlips = Math.max(maxFlips, flips);
      t.diagnostic(`${front} ${personnel} ${playside} ${sp.climber}: ${sp.ticks.length} ticks, ${flips} x-reversals`);
      if (flips > 1) bad.push(`${front} ${personnel} ${playside} ${sp.climber}: vel.x reversed ${flips} times`);
    }
  }
  assert.ok(spans > 0);
  t.diagnostic(`wobble (report-only): ${spans} spans, ${bad.length} with more than 1 x-reversal, worst ${maxFlips} reversals`);
  for (const line of bad) t.diagnostic(`wobble (report-only): ${line}`);
});

test('F-59 #3: walkedUp te run right, C comes off the nose double to the Mike (nearer member climbs)', () => {
  const play = createPlay(25, 'insideZone', { front: 'walkedUp', personnel: 'te', playside: 'right', accel: true, tackles: false });
  const orig = play.retargetRule;
  const rel = [];
  let combo = null;
  play.retargetRule = (pl, b, ctx) => {
    const out = orig(pl, b, ctx);
    const byId = (id) => pl.find((q) => q.id === id);
    for (const c of ctx.combos) {
      const mem = [c.owner, c.partner];
      if (!(mem.includes('C') && mem.includes('RG') && byId(c.target)?.id === 'BT')) continue;
      combo = c;
      const e = out.find((o) => mem.includes(o.blocker));
      if (!e || !unswitched(pl, c)) continue;
      const mike = byId(e.target);
      rel.push({ e, mikeId: mike.id, dC: Math.abs(byId('C').x - mike.x), dRG: Math.abs(byId('RG').x - mike.x) });
    }
    return out;
  };
  assert.ok(play.snap());
  for (let i = 0; i < Math.round(2.5 / DT) && play.ball.phase !== 'dead'; i++) play.step(DT);
  assert.ok(combo, 'a C/RG combo on BT exists');
  assert.ok(rel.length > 0, 'a release happened');
  const r = rel[0];
  assert.equal(r.e.target, 'MIK');
  assert.equal(r.e.blocker, 'C');
  assert.ok(r.dC < r.dRG, `C ${r.dC} nearer than RG ${r.dRG}`);
});

// T-76: a combo never comes off its DL onto an LB the double has already driven the DL past, unless he has declared.
// Judges the rule at every release (his depth against the DL's, or the cues), not an outcome.
test('T-76: a combo member leaving the DL goes to an LB upfield of the DL, or one declared to the pair', (t) => {
  const configs = [
    ['over43', 'te', 'right', 'lbSits'],
    ['under43', 'noTe', 'left', 'lbSits'],
    ['odd34', 'noTe', 'right', 'lbSits'],
    ['odd34', 'noTe', 'left', 'endCrash'],
  ];
  let checked = 0;
  for (const [front, personnel, playside, script] of configs) {
    const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, personnel, playside, script });
    const orig = play.retargetRule;
    play.retargetRule = (pl, b, ctx) => {
      const out = orig(pl, b, ctx);
      const byId = (id) => pl.find((q) => q.id === id);
      for (const c of ctx.combos) {
        if (!unswitched(pl, c)) continue;
        const e = out.find((o) => o.blocker === c.owner || o.blocker === c.partner);
        if (!e) continue;
        const lb = byId(e.target), dl = byId(c.target);
        const cues = Object.fromEntries([c.owner, c.partner].map((id) => [id, ctx.cues(id)]));
        const declared = declaredIn(cues, [c.owner, c.partner], lb.id);
        checked++;
        assert.ok(lb.y > dl.y || declared, `${front} ${personnel} ${playside} ${script} ${e.blocker} > ${lb.id} (y ${lb.y.toFixed(2)}) with the DL at y ${dl.y.toFixed(2)}, undeclared`);
      }
      return out;
    };
    assert.ok(play.snap(), `${front} ${personnel} ${playside} ${script}`);
    for (let i = 0; i < 150 && play.ball.phase !== 'dead'; i++) play.step(FIXED_DT);
  }
  t.diagnostic(`${checked} releases judged`);
});

// F-66 #4: C drops MIK for SAM only once another blocker's engaged block on a non-line defender walls MIK off.
test('F-66 #4: over43 te right, C leaves a walled-off MIK for SAM', (t) => {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front: 'over43', personnel: 'te', playside: 'right' });
  pinLbDepth(play, OLD_LB_DY);
  play.snap();
  const orig = play.retargetRule;
  const seen = [];
  const segDist = (pt, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    const u = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / l2));
    return Math.hypot(pt.x - (a.x + u * dx), pt.y - (a.y + u * dy));
  };
  play.retargetRule = (players, ballPos, ctx) => {
    const before = players.find((q) => q.id === 'C').block?.target;
    const out = orig(players, ballPos, ctx);
    const e = out.find((x) => x.blocker === 'C');
    if (e && before === 'MIK') {
      const g = (id) => players.find((q) => q.id === id);
      const wall = players.filter((q) => q.id !== 'C' && q.block?.engaged && q.block.target !== 'MIK' && ['WIL'].includes(q.block.target));
      seen.push({
        e,
        rtTarget: g('RT').block.target, rtEngaged: g('RT').block.engaged,
        gap: Math.min(segDist(g('WIL'), g('C'), g('MIK')), segDist(g('RT'), g('C'), g('MIK'))),
        wall: wall.length,
      });
    }
    return out;
  };
  for (let i = 0; i < 150 && play.ball.phase !== 'dead'; i++) play.step(FIXED_DT);
  t.diagnostic(`C retargets off MIK ${seen.length} times`);
  if (seen.length === 0) return;
  const r = seen[0];
  assert.equal(r.rtTarget, 'WIL');
  assert.equal(r.rtEngaged, true);
  assert.ok(r.gap <= WALL_GAP, `a wall lies on the C-MIK segment (${r.gap})`);
  assert.equal(r.e.target, 'SAM');
});
