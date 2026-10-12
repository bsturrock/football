import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { TACKLE_DIST } from '../src/dots/tackle.js';
import { zonePlan, zoneSwitch, pickClimber, SWITCH_DIST, COMBO_TOUCH, RIDE_DEPTH, TRACK_HALF, INSIDE_ZONE, ZONE_READ, dangerOf, claimedSet, unclaimedInReach, DANGER_MARGIN } from '../src/dots/zone.js';
import { RULES, CLIMB_REACH, runScheme } from '../src/dots/assign.js';
import { readFront, HEAD_UP } from '../src/dots/front.js';
import { LOS, FRONT_NAMES, frontPlayers, frontNumbers } from './fixtures/fronts.js';
import { buildLineup, PLAYS, FRONTS, LB_ROLES } from '../src/dots/roster.js';
import { LB_SHIFT_STEP, DL_SHIFT_STEP } from '../src/dots/play.js';
import { numberPlay, A_GAP_HALF } from '../src/dots/numbering.js';
import { RELEASE_PAST } from '../src/dots/geometry.js';
import { IZ_PLAN_PINS } from './fixtures/base-front.js';

test('scheme flag on insideZone', () => assert.equal(PLAYS.insideZone.scheme, 'zone'));

const PERSONNELS = ['noTe', 'te'];
const withoutFront = ({ front, ...rest }) => rest;
const planOf = (name, personnel = 'noTe', players = frontPlayers(name, personnel)) =>
  withoutFront(zonePlan(players, frontNumbers(players), LOS));

test('every front gets the agreed plan', () => {
  for (const personnel of PERSONNELS) {
    for (const [name, pin] of Object.entries(IZ_PLAN_PINS[personnel])) {
      assert.ok(FRONT_NAMES.includes(name), name);
      assert.deepEqual(planOf(name, personnel), { side: -1, ...pin }, `${personnel} ${name}`);
    }
  }
});

test('every rule row names a registered rule', () => {
  for (const r of INSIDE_ZONE.rules) assert.ok(Object.hasOwn(RULES, r.when), r.when);
});

test('invariants over all fronts', () => {
  for (const [personnel, fname] of PERSONNELS.flatMap((pe) => FRONT_NAMES.map((n) => [pe, n]))) {
    const name = `${personnel} ${fname}`;
    {
    const players = frontPlayers(fname, personnel);
    const numbers = frontNumbers(players);
    const front = readFront(players, numbers, LOS);
    const full = zonePlan(players, numbers, LOS);
    assert.deepEqual(full.front, readFront(players, numbers, LOS), `${name} front`);
    const r = withoutFront(full);
    const lineDef = front.defenders.filter((d) => d.level === 'line');
    const vals = Object.values(r.blocks);
    // (a) every line defender with a cover is a block target
    for (const d of lineDef) {
      // F-54 #5 / R-5: plain inside zone has no spared edge, so the exception for it is gone
      if (d.cover != null) assert.ok(vals.includes(d.id), `${name} (a) ${d.id}`);
    }
    // (b) at most twice, only as a combo's target with its owner and partner
    for (const d of front.defenders) {
      const who = Object.keys(r.blocks).filter((k) => r.blocks[k] === d.id);
      assert.ok(who.length <= 2, `${name} (b) ${d.id}`);
      if (who.length === 2) {
        const c = r.combos.find((x) => x.target === d.id);
        assert.ok(c, `${name} (b) combo ${d.id}`);
        assert.deepEqual([c.owner, c.partner].sort(), [...who].sort(), `${name} (b) pair ${d.id}`);
      }
    }
    // (c) watches distinct, each null or a second-level defender
    const watches = Object.values(r.techs).map((t) => t.watch).filter((w) => w != null);
    for (const c of r.combos) {
      const d = front.defenders.find((x) => x.id === c.watch);
      assert.ok(c.watch == null || (d && d.level === 'second'), `${name} (c) level ${c.watch}`);
    }
    assert.equal(new Set(r.combos.map((c) => c.watch)).size, r.combos.length, `${name} (c) distinct`);
    assert.ok(watches.every((w) => front.defenders.find((x) => x.id === w)?.level === 'second'), name);
    // (d) reach
    const byId = new Map(players.map((p) => [p.id, p]));
    for (const [b, t] of Object.entries(r.blocks)) {
      if (r.techs[b].tech === 'climb') continue;
      assert.ok(Math.abs(byId.get(t).x - byId.get(b).x) <= CLIMB_REACH, `${name} (d) ${b}`);
    }
    // (e) stability, order independence, purity
    for (const nudge of [0.02, -0.02]) {
      const moved = players.map((p) => (p.team === 'defense' ? { ...p, x: p.x + nudge } : p));
      assert.deepEqual(withoutFront(zonePlan(moved, numbers, LOS)), r, `${name} nudge ${nudge}`);
    }
    assert.deepEqual(withoutFront(zonePlan([...players].reverse(), numbers, LOS)), r, `${name} reversed`);
    const p0 = structuredClone(players);
    const n0 = structuredClone(numbers);
    zonePlan(players, numbers, LOS);
    assert.deepEqual(players, p0);
    assert.deepEqual(numbers, n0);
    }
  }
});

// The backside end lineman climbed to a second-level man, leaving the edge man for the free list (ZONE_READ only since F-54 #5 / R-5).
const sparedEdge = (front, plan) => {
  const end = front.line[front.line.length - 1];
  const t = front.defenders.find((d) => d.id === plan.blocks[end.id]);
  return plan.techs[end.id]?.tech === 'climb' && t?.level === 'second' && plan.free.includes(front.edge);
};

const eachFront = (fn) => {
  for (const personnel of PERSONNELS) {
    for (const name of FRONT_NAMES) {
      const players = frontPlayers(name, personnel);
      const numbers = frontNumbers(players);
      const front = readFront(players, numbers, LOS);
      fn({ label: `${personnel} ${name}`, personnel, name, players, numbers, front, plan: withoutFront(zonePlan(players, numbers, LOS)), read: withoutFront(zonePlan(players, numbers, LOS, { scheme: ZONE_READ })) });
    }
  }
};

test('F-36 #1: surface is one live split outside each end lineman', () => {
  eachFront(({ label, front }) => {
    const { line } = front;
    const n = line.length;
    const play = line[0].u + (n > 1 ? line[0].u - line[1].u : 2 * A_GAP_HALF);
    const back = line[n - 1].u - (n > 1 ? line[n - 2].u - line[n - 1].u : 2 * A_GAP_HALF);
    assert.deepEqual(front.surface, { play, back }, label);
  });
});

test('F-36 #2: cover windows end at the surface', () => {
  eachFront(({ label, front }) => {
    for (const d of front.defenders.filter((x) => x.level === 'line')) {
      const outside = d.u >= front.surface.play - HEAD_UP || d.u < front.surface.back + HEAD_UP;
      assert.equal(d.cover === null, outside, `${label} ${d.id}`);
    }
  });
  const cov = (name, id) => {
    const p = frontPlayers(name, 'noTe');
    const f = readFront(p, frontNumbers(p), LOS);
    return { d: f.defenders.find((x) => x.id === id), f };
  };
  for (const [name, id] of [['odd34', 'PO'], ['odd34', 'BO'], ['walkedUp', 'SAM'], ['dlMinus4', 'RDE']]) {
    assert.equal(cov(name, id).d.cover, null, `${name} ${id}`);
  }
  const bear = cov('bear', 'PE');
  assert.equal(bear.d.cover, bear.f.line[0].id);
  for (const [name, id] of [['base', 'LDE'], ['odd34', 'BE']]) {
    const r = cov(name, id);
    assert.equal(r.d.cover, r.f.line[r.f.line.length - 1].id, `${name} ${id}`);
  }
});

// Restated by F-54 #5 / R-5: plain inside zone never spares the edge, so no exception remains.
test('F-36 #3: the backside end man is blocked, and every covered line man is a target', () => {
  eachFront(({ label, personnel, front, plan }) => {
    const targets = Object.values(plan.blocks);
    const edge = front.defenders.find((d) => d.id === front.edge);
    if (edge && edge.cover != null) assert.ok(targets.includes(edge.id), `${label} edge`);
    if (personnel === 'te') assert.ok(targets.includes(front.edge), `${label} edge blocked`);
  });
});

// Restated by F-54 #5 / R-5: the spare row belongs to ZONE_READ, so the spare rule is pinned there.
test('F-50 #2: under ZONE_READ the spare climb fires only when a second-level man would otherwise be free', () => {
  eachFront(({ label, front, read: plan }) => {
    const end = front.line[front.line.length - 1];
    if (!sparedEdge(front, plan)) return;
    const old = runScheme(front, INSIDE_ZONE);
    const hit = old.free.some((id) => {
      const d = front.defenders.find((x) => x.id === id);
      return d.level === 'second' && Math.abs(d.x - end.x) <= CLIMB_REACH;
    });
    assert.ok(hit, `${label} spared with no free second-level man in reach`);
  });
});

// Restated by F-54 #5 / R-5 (the old pin was a greedy nearest-count deal that the T-24 best matching, Mike first, already departs from once one unit alone is dealt): each unit's second-level man is distinct, in its reach, and more backside than the unit before it.
test('F-36 #5: second-level men are taken in zone count order', () => {
  eachFront(({ label, front, plan }) => {
    const second = front.defenders.filter((d) => d.level === 'second');
    const picks = [];
    front.line.forEach((l) => {
      const t = plan.techs[l.id];
      if (t.tech === 'climb') picks.push({ id: plan.blocks[l.id], ref: l.x });
      else if (t.tech === 'combo' && plan.combos.some((c) => c.owner === l.id)) {
        const c = plan.combos.find((x) => x.owner === l.id);
        const p = front.line.find((x) => x.id === c.partner);
        if (c.watch != null) picks.push({ id: c.watch, ref: (l.x + p.x) / 2 });
      }
    });
    let lastU = Infinity;
    for (const { id, ref } of picks) {
      const d = second.find((x) => x.id === id);
      assert.ok(d, `${label} pick ${id} is second-level`);
      assert.ok(Math.abs(d.x - ref) <= CLIMB_REACH, `${label} pick ${id} in reach`);
      assert.ok(d.u < lastU, `${label} pick ${id} more backside than the one before`);
      lastU = d.u;
    }
    const coveredCount = front.defenders.filter((d) => d.level === 'line' && d.cover != null).length;
    const zero = front.defenders.find((d) => d.level === 'second' && d.n === 0);
    if (zero && coveredCount < front.line.length) {
      const hit = Object.values(plan.blocks).includes(zero.id) || plan.combos.some((c) => c.watch === zero.id);
      assert.ok(hit, `${label} n=0 defender used`);
    }
  });
});

test('F-36 #6: box count and free men', () => {
  eachFront(({ label, personnel, front, plan }) => {
    const watches = plan.combos.map((c) => c.watch).filter((w) => w != null);
    assert.equal(new Set([...Object.values(plan.blocks), ...watches]).size, Math.min(front.line.length, front.box), label);
    for (const id of plan.free) {
      const d = front.defenders.find((x) => x.id === id);
      assert.ok(d.level === 'second' || d.cover == null, `${label} free ${id}`); // F-54 #5 / R-5: no spared edge under plain inside zone
    }
    // F-54 #5: derived from the front, not a literal: with a TE the line has a blocker for each of its men, so the free men are the box defenders the blockers cannot take (none when there are more blockers than box defenders)
    if (personnel === 'te') assert.equal(plan.free.length, Math.max(0, front.box - front.line.length), label);
  });
});

test('F-36 #3/#4: shifted lineups, edge blocked, no reach past a teammate, no target outside the surface', () => {
  for (const front of Object.keys(FRONTS)) {
    for (let k = -4; k <= 4; k++) {
      for (let j = -6; j <= 6; j++) {
        for (const personnel of PERSONNELS) {
          const players = buildLineup(LOS, 'insideZone', { front, dlShift: k * DL_SHIFT_STEP, lbShift: j * LB_SHIFT_STEP, personnel });
          const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
          const f = readFront(players, numbers, LOS);
          const plan = withoutFront(zonePlan(players, numbers, LOS));
          const label = `${front} ${k} ${j} ${personnel}`;
          const dOf = (id) => f.defenders.find((d) => d.id === id);
          const edge = dOf(f.edge);
          // F-54 #5 / R-5: no spared edge under plain inside zone
          if (edge && edge.cover != null) assert.ok(Object.values(plan.blocks).includes(edge.id), `${label} edge`);
          const comboMembers = new Set(plan.combos.flatMap((c) => [c.owner, c.partner]));
          f.line.forEach((l, i) => {
            const t = dOf(plan.blocks[l.id]);
            if (!t || t.level !== 'line') return;
            assert.notEqual(t.cover, null, `${label} ${l.id} target outside surface`);
            if (i > 0 && !comboMembers.has(l.id)) {
              assert.ok(t.u <= f.line[i - 1].u + HEAD_UP, `${label} ${l.id} reaches past teammate`);
            }
          });
        }
      }
    }
  }
});

// F-55: COMBO_HOLD is gone; the tests keep a pair that has been on the DL a while (0.3 s) as their default hold
const HELD = 0.3;
const sw = () => {
  const players = buildLineup(25, 'insideZone', { lbShift: -6 * LB_SHIFT_STEP });
  const g = (id) => players.find((p) => p.id === id);
  const blk = { target: 'RDT', angle: 'straight', engaged: true, seq: 1, held: HELD };
  g('C').block = { ...blk };
  g('LG').block = { ...blk };
  Object.assign(g('C'), { x: 0, y: 24.3 });
  Object.assign(g('LG'), { x: -2.2, y: 23.8 });
  const ctx = { combos: [{ owner: 'C', partner: 'LG', target: 'RDT', watch: 'MLB' }] };
  return { players, g, ctx };
};
const at = (x, y, mut) => {
  const s = sw();
  Object.assign(s.g('MLB'), { x, y });
  if (mut) mut(s);
  return zoneSwitch(s.players, null, s.ctx);
};

test('F-12 #4a: unmoved, out of range', () => assert.deepEqual(at(-1.6, 29.5), []));
test('F-12 #4f: range: laterally nearer LG', () =>
  assert.deepEqual(at(-1.3, 25.0), [{ blocker: 'LG', target: 'MLB' }]));
test('F-12 #4g: range lateral tie goes to owner', () =>
  assert.deepEqual(at(-1.1, 25.0, (s) => {
    Object.assign(s.g('LG'), { x: -2.2, y: 24.3 });
  }), [{ blocker: 'C', target: 'MLB' }]));
test('range boundary: inside SWITCH_DIST goes to C', () =>
  assert.deepEqual(at(0, 24.3 + SWITCH_DIST - 0.05), [{ blocker: 'C', target: 'MLB' }]));
test('range boundary: outside SWITCH_DIST stays', () =>
  assert.deepEqual(at(0, 24.3 + SWITCH_DIST + 0.05), []));
test('F-12 #4i: already switched', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.target = 'MLB'; }), []));
test('F-12 #4j: no combos or ctx', () => {
  const { players } = sw();
  assert.deepEqual(zoneSwitch(players, null, {}), []);
  assert.deepEqual(zoneSwitch(players, null, undefined), []);
});
test('F-12 #4k: purity', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -2.2, y: 29.5 });
  const p0 = structuredClone(players);
  const c0 = structuredClone(ctx);
  zoneSwitch(players, null, ctx);
  assert.deepEqual(players, p0);
  assert.deepEqual(ctx, c0);
});

// F-55 #1/#2: zoneSwitch reads the LB only through ctx.cues(memberId) = { track: { ids, lb }, lbs: { [lbId]: state } }.
// sees(state, inTrack, id): both members see `id` (default MLB) in `state`; inTrack puts him in their track ids.
const sees = (state, inTrack = true, id = 'MLB') => (s) => {
  s.ctx.cues = () => ({ track: { ids: inTrack ? [id] : [], lb: inTrack ? id : null }, lbs: { [id]: state } });
};
// seesBy(memberId, state, inTrack): only that member sees him
const seesBy = (member, state, inTrack = true, id = 'MLB') => (s) => {
  s.ctx.cues = (m) => (m === member
    ? { track: { ids: inTrack ? [id] : [], lb: inTrack ? id : null }, lbs: { [id]: state } }
    : { track: { ids: [], lb: null }, lbs: {} });
};
const ctxNoFn = (ctx) => { const { cues, ...rest } = ctx; return structuredClone(rest); };
test('F-19 #8 (restated F-55 #1): declared (filling in track), MLB out of range, fit past pair picks LG', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { sees('filling')(s); s.ctx.defGoals = { MLB: { x: -1.5 } }; }), [{ blocker: 'LG', target: 'MLB' }]));
test('F-19 #8 (restated F-55 #1, F-59): the declaration only triggers; the LB position picks the climber, not the goal', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { sees('filling')(s); s.ctx.defGoals = { MLB: { x: 0.4 } }; }), [{ blocker: 'LG', target: 'MLB' }]));
test('F-19 #8 (restated F-55 #1): declaration with no goal falls back to the watch position', () =>
  assert.deepEqual(at(0.4, 29.5, sees('filling')), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8 (restated F-55 #1, F-59): lateral tie of the LB position goes to owner', () =>
  assert.deepEqual(at(-1.1, 29.5, (s) => { sees('filling')(s); s.ctx.defGoals = { MLB: { x: -2 } }; }), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8 (restated F-55 #1, F-59): a declaration beats range', () =>
  assert.deepEqual(at(0.4, 29.5, (s) => { sees('filling')(s); s.ctx.defGoals = { MLB: { x: -2 } }; }), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8 (restated F-55 #1): a declaration for another id does not trigger the watched LB', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { sees('filling', true, 'WLB')(s); place(s, [['WLB', 40, 40]]); }), []));
test('F-19 #8 (restated F-55): no ctx.cues (or null) -> nobody declared, range rule only', () => {
  assert.deepEqual(at(-1.6, 29.5, (s) => { s.ctx.cues = null; }), []);
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.ctx.cues = null; }), [{ blocker: 'LG', target: 'MLB' }]);
});
test('F-19 #8 (restated F-55): already switched with a declaration -> none', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => {
    s.g('C').block.target = 'MLB';
    sees('filling')(s);
  }), []));
test('F-19 #8 (restated F-55): purity with cues', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -1.6, y: 29.5 });
  sees('filling')({ ctx });
  const p0 = structuredClone(players);
  const c0 = ctxNoFn(ctx);
  zoneSwitch(players, null, ctx);
  assert.deepEqual(players, p0);
  assert.deepEqual(ctxNoFn(ctx), c0);
});

// F-55 #8: C already switched to MLB (LB1), LG still on RDT; the other LBs are WLB/SLB (LB2).
test('F-55 #8: a climber lets an LB leaving the play go for the most dangerous unclaimed LB', () => {
  const run = (side, mut) => {
    const s = sw();
    const k = side; // mirror x about the playside sign
    s.ctx.side = side;
    s.g('C').block = { target: 'MLB', angle: 'straight', engaged: false, seq: 1 };
    Object.assign(s.g('C'), { x: 0, y: 25 });
    Object.assign(s.g('MLB'), { x: -k * 2.5, y: 29, vel: { x: -k * 3, y: 0 } });
    const others = s.players.filter((p) => LB_ROLES.includes(p.role) && p.id !== 'MLB');
    others.forEach((p) => Object.assign(p, { x: 40, y: 40, vel: { x: 0, y: 0 } }));
    s.lb2 = others[0];
    mut?.(s, k);
    return { out: zoneSwitch(s.players, null, s.ctx), s };
  };
  const nearLb2 = (s, k) => Object.assign(s.lb2, { x: k * 1, y: 29 });
  for (const side of [1, -1]) {
    const a = run(side, nearLb2);
    assert.deepEqual(a.out, [{ blocker: 'C', target: a.s.lb2.id }], `(a/f) side ${side}`);
    assert.deepEqual(run(side).out, [], `(b) side ${side}: no other LB`);
    assert.deepEqual(run(side, (s, k) => { nearLb2(s, k); s.g('C').block.engaged = true; }).out, [], `(c) side ${side}: engaged`);
    assert.deepEqual(run(side, (s, k) => { nearLb2(s, k); s.g('MLB').vel = { x: k * 3, y: 0 }; }).out, [], `(d) side ${side}: flowing playside`);
    assert.deepEqual(run(side, (s, k) => { nearLb2(s, k); s.g('MLB').x = k * 2.5; }).out, [], `(e) side ${side}: playside of the climber`);
    assert.deepEqual(run(side, (s, k) => { nearLb2(s, k); Object.assign(s.g('MLB'), { x: -k * 1, vel: { x: -k * 3, y: 0 } }); }).out, [], `(g) side ${side}: backside but inside the track`);
    assert.deepEqual(run(side, (s, k) => { nearLb2(s, k); Object.assign(s.g('MLB'), { vel: { x: -k * 2, y: -3 } }); }).out, [], `(h) side ${side}: backside outside the track but filling downhill`);
  }
});

// F-60 #1: one LB-gone rule for every unengaged climber: his LB is leaving the play, or the ball is RELEASE_PAST upfield of him.
test('F-60 #1: an LB-gone climber (combo member or single) takes another unclaimed LB in reach', () => {
  const run = (mut) => {
    const s = sw();
    s.g('C').block = { target: 'MLB', angle: 'straight', engaged: false, seq: 1 };
    Object.assign(s.g('C'), { x: 0, y: 25 });
    Object.assign(s.g('MLB'), { x: 0, y: 25, vel: { x: 0, y: 0 } });
    const others = s.players.filter((p) => LB_ROLES.includes(p.role) && p.id !== 'MLB');
    others.forEach((p) => Object.assign(p, { x: 40, y: 40, vel: { x: 0, y: 0 } }));
    s.lb2 = others[0];
    mut(s);
    return { out: zoneSwitch(s.players, s.ball ?? null, s.ctx), s };
  };
  const past = (s) => { s.ball = { x: 0, y: 25 + RELEASE_PAST + 0.1 }; };
  const nearLb2 = (s) => Object.assign(s.lb2, { x: 1, y: 29 });
  // (a) combo member already switched to an LB; the ball is past him, another LB is not
  const a = run((s) => { past(s); nearLb2(s); });
  assert.deepEqual(a.out, [{ blocker: 'C', target: a.s.lb2.id }], '(a)');
  // (b) a single climber (tech climb, in no combo) whose LB is leaving the play
  const b = run((s) => {
    s.ctx.combos = [];
    s.ctx.side = 1;
    s.ctx.tech = { C: 'climb' };
    nearLb2(s);
    Object.assign(s.g('MLB'), { x: -2.5, y: 29, vel: { x: -3, y: 0 } });
  });
  assert.deepEqual(b.out, [{ blocker: 'C', target: b.s.lb2.id }], '(b)');
  // (c) no other LB in reach: he keeps his man
  assert.deepEqual(run(past).out, [], '(c) ball past');
  assert.deepEqual(run((s) => { past(s); nearLb2(s); s.lb2.y = 25; }).out, [], '(c) the other LB is past too');
  // (d) an engaged blocker is not moved by this rule
  assert.deepEqual(run((s) => { past(s); nearLb2(s); s.g('C').block.engaged = true; }).out, [], '(d)');
});

const blkAt = (x) => ({ id: 'B' + x, x });
const lbAt = (x) => ({ id: 'L', x });
test('pickClimber: the member laterally nearer the linebacker climbs, either side', () => {
  const [a, b] = [blkAt(-1), blkAt(1)];
  assert.equal(pickClimber(a, b, lbAt(0.5)), b);
  assert.equal(pickClimber(a, b, lbAt(-0.5)), a);
  assert.equal(pickClimber(b, a, lbAt(0.5)), b);
  assert.equal(pickClimber(b, a, lbAt(-0.5)), a);
});
test('pickClimber: exact tie goes to the owner whichever argument order', () => {
  const [a, b] = [blkAt(-1), blkAt(1)];
  assert.equal(pickClimber(a, b, lbAt(0)), a);
  assert.equal(pickClimber(b, a, lbAt(0)), b);
});
test('zoneSwitch: the live LB position decides the climber, not defGoals (restated F-59)', () => {
  // the LB's live position names the climber; a goal far on the other side changes nothing
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.ctx.defGoals = { MLB: { x: 2 } }; }), [{ blocker: 'LG', target: 'MLB' }]);
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.ctx.defGoals = { MLB: { x: -3 } }; }), [{ blocker: 'LG', target: 'MLB' }]);
  assert.deepEqual(at(-0.2, 25.0, (s) => { s.ctx.defGoals = { MLB: { x: -2 } }; }), [{ blocker: 'C', target: 'MLB' }]);
});
test('zoneSwitch: the nearer member climbs whatever the side or DL position (restated F-59)', () => {
  // the nearer member to the LB climbs whatever side or DL position; moving the DL past the LB changes nothing
  for (const side of [1, -1]) for (const dx of [-1.0, 1.0, -3, 3]) {
    const s = sw();
    Object.assign(s.g('RDT'), { x: dx });
    Object.assign(s.g('MLB'), { x: -1.3, y: 25.0 });
    s.ctx.side = side;
    s.ctx.defGoals = { MLB: { x: 0.9 } };
    assert.deepEqual(zoneSwitch(s.players, null, s.ctx), [{ blocker: 'LG', target: 'MLB' }], `side ${side} dl ${dx}`);
  }
});

// Restated by T-9 (F-3 #1, round 3), again by F-55 #1/#2: the climber comes off only when the watched LB declares (cues), judged from the members' perception, never from LB velocity or defense internals. HELD was COMBO_HOLD.
const joint = (j) => (s) => { s.g('C').block.held = j; s.g('LG').block.held = j; };
const far = [-1.6, 29.5]; // beyond SWITCH_DIST of both blockers
test('gate: stayer just engaged, climber held -> switch (F-55 #1: declared LB; joint hold counted)', () => {
  // restated: a declared LB needs the joint hold (min of both) at COMBO_TOUCH; one man's hold is not enough
  const m = (extra) => (s) => { sees('filling')(s); extra(s); };
  assert.deepEqual(at(...far, m((s) => { s.g('C').block.held = 0; s.g('LG').block.held = HELD + 0.2; })), [], 'stayer held 0: not yet a double');
  assert.deepEqual(at(...far, m((s) => { s.g('C').block.held = HELD; s.g('LG').block.held = HELD + 0.2; })), [{ blocker: 'LG', target: 'MLB' }]);
});
test('gate: climber not engaged -> none (F-55 #1)', () => {
  // restated: a declared LB far away and a climber not yet on the DL: the hold counted is the stayer's alone, so a stayer just on (held 0) releases nothing; once he has held COMBO_TOUCH the climber (who has nothing to leave) goes
  const m = (h) => (s) => { sees('filling')(s); s.g('LG').block.engaged = false; s.g('C').block.held = h; };
  assert.deepEqual(at(...far, m(0)), []);
  assert.deepEqual(at(...far, m(COMBO_TOUCH)), [{ blocker: 'LG', target: 'MLB' }]);
});
test('F-3 #1 (i) (restated F-55 #1): joint under COMBO_TOUCH, LB declared -> none', () =>
  assert.deepEqual(at(...far, (s) => { sees('filling')(s); joint(COMBO_TOUCH - 0.01)(s); }), []));
test('F-3 #1 (ii) (restated F-55 #1): joint at COMBO_TOUCH, LB declared (filling in track) -> switch', () =>
  assert.deepEqual(at(...far, (s) => { sees('filling')(s); joint(COMBO_TOUCH)(s); }), [{ blocker: 'LG', target: 'MLB' }]));
test('F-3 #1 (iii) (restated F-55 #2): LB sitting or flowing outside the track never releases, however long the pair holds', () => {
  for (const [st, inTrack] of [['sitting', true], ['covering', true], ['flowing', true], ['flowing', false], ['sitting', false]]) {
    assert.deepEqual(at(...far, (s) => { sees(st, inTrack)(s); joint(5)(s); }), [], `${st} inTrack ${inTrack}`);
  }
});
test('F-3 #1 (iv) (restated F-55 #2): LB undeclared (no cues), beyond SWITCH_DIST, long joint hold -> none', () =>
  assert.deepEqual(at(...far, (s) => { joint(5)(s); }), []));
test('F-3 #1 (v): LB within SWITCH_DIST, only the stayer engaged -> switch (forced, no joint hold)', () =>
  // LG is the climber (fit is backside of the DL), C the stayer
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('LG').block.engaged = false; joint(0)(s); }), [{ blocker: 'LG', target: 'MLB' }]));
test('F-3 #1 (vi): LB within SWITCH_DIST but the stayer not engaged -> none', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.engaged = false; }), []));
test('F-3 #1 (vii): DL winning -> none, even forced', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('RDT').react = { state: 'winning' }; }), []));
test('gate: neither held long enough -> none', () =>
  // restated (F-55 #1): a declared LB and a joint hold just under COMBO_TOUCH
  assert.deepEqual(at(...far, (s) => { sees('filling')(s); joint(COMBO_TOUCH - 0.01)(s); }), []));
test('gate: stayer not engaged -> none', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.engaged = false; }), []));
test('gate: winning DL -> none', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('RDT').react = { state: 'winning' }; }), []));
test('gate: declaration trigger uses the same gate (F-55 #1)', () => {
  // restated: the joint hold (min of both) gates a declared LB
  assert.deepEqual(at(...far, (s) => { sees('filling')(s); s.g('LG').block.held = HELD + 0.2; }), [{ blocker: 'LG', target: 'MLB' }]);
  assert.deepEqual(at(...far, (s) => { sees('filling')(s); s.g('C').block.held = 0; }), []);
  assert.deepEqual(at(...far, (s) => { sees('filling')(s); s.g('C').block.held = 0; s.g('LG').block.held = 0; }), []);
});
test('F-3 #1 (viii) (restated F-55 #1): a filling LB outside both tracks is not declared; only crossing declares from outside', () => {
  // human track rule: only an LB in a member's track (or across his face) pulls a blocker off the DL
  const out = [-2.2 - TRACK_HALF - 0.5, 29.5];
  assert.deepEqual(at(...out, (s) => { sees('filling', false)(s); joint(HELD)(s); }), []);
  assert.deepEqual(at(...out, (s) => { sees('crossing', false)(s); joint(HELD)(s); }), [{ blocker: 'LG', target: 'MLB' }]);
});
// F-55 #1/#2 new rule tests
test('F-55 #2 (restated F-59): a sitting LB never releases at any hold until the DL reaches los + RIDE_DEPTH, then the man on the LB side comes off', () => {
  for (const [fx, who] of [[-1.5, 'LG'], [0.4, 'C']]) {
    for (const h of [0.3, 1, 3]) {
      assert.deepEqual(at(...far, (s) => { sees('sitting')(s); joint(h)(s); s.ctx.los = 20; s.g('RDT').y = 20 + RIDE_DEPTH - 0.1; s.g('MLB').x = fx; }), [], `held ${h} before ride depth`);
      assert.deepEqual(at(...far, (s) => { sees('sitting')(s); joint(h)(s); s.ctx.los = 20; s.g('RDT').y = 20 + RIDE_DEPTH; s.g('MLB').x = fx; }), [{ blocker: who, target: 'MLB' }], `held ${h} at ride depth, fit ${fx}`);
    }
  }
});
test('F-55 #2: ride depth needs both members on the DL, and no ctx.los means no ride', () => {
  assert.deepEqual(at(...far, (s) => { sees('sitting')(s); joint(1)(s); s.ctx.los = 20; s.g('RDT').y = 26; s.g('LG').block.engaged = false; }), []);
  assert.deepEqual(at(...far, (s) => { sees('sitting')(s); joint(1)(s); s.g('RDT').y = 26; }), []);
});
test('F-55 #1 (restated F-59): filling in the owner track releases the owner when the LB fits on his side, the partner when on the other side', () => {
  // C is the owner (x 0), LG the partner (x -2.2); the DL sits at its lineup x between them; side +1 puts playside at +x
  const run = (fx, track) => at(fx, 29.5, (s) => { sees('filling')(s); s.ctx.side = 1; s.g('RDT').x = -1.1; joint(HELD)(s); if (track) track(s); });
  assert.deepEqual(run(0.4), [{ blocker: 'C', target: 'MLB' }]);
  assert.deepEqual(run(-2.6), [{ blocker: 'LG', target: 'MLB' }]);
  // only the owner sees the fill in his track
  assert.deepEqual(at(...far, (s) => { seesBy('C', 'filling')(s); s.ctx.side = 1; s.g('RDT').x = -1.1; s.g('MLB').x = 0.4; }), [{ blocker: 'C', target: 'MLB' }]);
  assert.deepEqual(at(...far, (s) => { seesBy('LG', 'filling')(s); s.ctx.side = 1; s.g('RDT').x = -1.1; s.g('MLB').x = -2.6; }), [{ blocker: 'LG', target: 'MLB' }]);
});
test('F-55 #1: crossing releases, with or without being in the track', () => {
  assert.deepEqual(at(...far, (s) => { sees('crossing', false)(s); }), [{ blocker: 'LG', target: 'MLB' }]);
  assert.deepEqual(at(...far, (s) => { sees('crossing', true)(s); }), [{ blocker: 'LG', target: 'MLB' }]);
});
test('F-55 #1: flowing outside both tracks does not release', () =>
  assert.deepEqual(at(...far, (s) => { sees('flowing', false)(s); }), []));
test('F-55 #1: forced (LB within SWITCH_DIST) releases at once, with no cues and no hold', () => {
  assert.deepEqual(at(0, 24.3 + SWITCH_DIST - 0.05, (s) => { s.ctx.cues = () => ({ track: { ids: [], lb: null }, lbs: {} }); joint(0)(s); }), [{ blocker: 'C', target: 'MLB' }]);
});
test('F-55 #1: declared but held under COMBO_TOUCH does not release', () =>
  assert.deepEqual(at(...far, (s) => { sees('crossing')(s); joint(COMBO_TOUCH - 0.01)(s); }), []));
test('F-55 #1: the planned watch sits while another unclaimed LB fills into a member track: the climber goes to the filling LB', () => {
  const s = sw();
  s.ctx.side = 1;
  for (const l of lbs(s)) place(s, [[l.id, 40, 40]]);
  place(s, [['MLB', -1.6, 29.5], ['WLB', -1.3, 28.0]]);
  s.ctx.cues = () => ({ track: { ids: ['WLB'], lb: 'WLB' }, lbs: { MLB: 'sitting', WLB: 'filling' } });
  const out = zoneSwitch(s.players, { x: -1, y: 24 }, s.ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0].target, 'WLB');
});
test('gate: zoneSwitch leaves ctx and players alone (no climber lock)', () => {
  const s = sw();
  Object.assign(s.g('MLB'), { x: -1.3, y: 25.0 });
  s.g('C').block.engaged = false;
  const p0 = structuredClone(s.players);
  const c0 = structuredClone(s.ctx);
  assert.deepEqual(zoneSwitch(s.players, null, s.ctx), []);
  assert.deepEqual(s.players, p0);
  assert.deepEqual(s.ctx, c0);
});

// Restated by F-54 #5 / R-5: plain inside zone no longer spares the end man, so the man-short TE blocks the end instead of climbing; the climb-and-contain play moves to ZONE_READ (plan level below).
test('F-50 #4: man-short zone, the TE blocks the backside end man and he is blocked before he can tackle', () => {
  for (const front of ['under43', 'backedOff']) {
    const play = createPlay(25, 'insideZone', { front, personnel: 'te', tackles: false });
    assert.ok(play.snap(), front);
    const f = readFront(play.players, play.numbers, 25);
    const id = play.player('TE').block.target;
    assert.equal(id, f.edge, `${front} TE target is the end man`);
    const lb = play.player(id);
    let engagedAt = null;
    for (let t = 0; t <= 2.0 + 1e-9 && engagedAt == null; t += 1 / 60) {
      play.step(1 / 60);
      if (play.blockersOf(id).length > 0) engagedAt = t;
      else if (play.ball.phase === 'carried') {
        const b = play.ballPosition();
        assert.ok(Math.hypot(lb.x - b.x, lb.y - b.y) > TACKLE_DIST, `${front} ${id} reached the ball unblocked at ${t.toFixed(2)}`);
      }
    }
    assert.notEqual(engagedAt, null, `${front} ${id} never blocked within 2.0 s`);
  }
});

// T-162: live second-level target (F-50 #5).
const lbs = (s) => s.players.filter((p) => LB_ROLES.includes(p.role));
const place = (s, spots) => { for (const [id, x, y] of spots) Object.assign(s.g(id), { x, y }); };
test('T-162: dangerOf uses defGoals over position; no ball is 0', () => {
  const s = sw();
  place(s, [['MLB', 0, 30]]);
  assert.equal(dangerOf(s.g('MLB'), { x: 0, y: 25 }, s.ctx), 5);
  s.ctx.defGoals = { MLB: { x: 3, y: 29 } };
  assert.equal(dangerOf(s.g('MLB'), { x: 0, y: 29 }, s.ctx), 3);
  assert.equal(dangerOf(s.g('MLB'), null, s.ctx), 0);
});
test('T-162: the plan watch holds inside the margin, a clearly more dangerous LB takes over past it', () => {
  const s = sw();
  s.ctx.side = 1;
  place(s, [['MLB', -1.3, 25.0], ['WLB', 2, 30]]);
  const ball = { x: -1.3, y: 24 };
  for (const l of lbs(s)) if (l.id !== 'MLB' && l.id !== 'WLB') place(s, [[l.id, 40, 40]]);
  assert.ok(DANGER_MARGIN > 0.5 && DANGER_MARGIN < 1.5);
  // inside the margin: the plan MLB (1.0 away) keeps the double against a WLB 0.5 away
  place(s, [['MLB', -1.3, 25.0], ['WLB', -1.3, 24.5]]);
  assert.deepEqual(zoneSwitch(s.players, ball, s.ctx).map((e) => e.target), ['MLB']);
  // past it: MLB 2.0 away, WLB 0.5 away
  place(s, [['MLB', -1.3, 26.0], ['WLB', -1.3, 24.5]]);
  assert.deepEqual(zoneSwitch(s.players, ball, s.ctx).map((e) => e.target), ['WLB']);
});
test('T-162: a null plan watch takes the most dangerous LB in reach; none in reach = no switch', () => {
  const s = sw();
  s.ctx.side = 1;
  s.ctx.combos[0].watch = null;
  for (const l of lbs(s)) place(s, [[l.id, 40, 40]]);
  assert.deepEqual(zoneSwitch(s.players, { x: 0, y: 25 }, s.ctx), []);
  place(s, [['MLB', -1.3, 27], ['WLB', -1.3, 25.0]]);
  assert.deepEqual(zoneSwitch(s.players, { x: 0, y: 25 }, s.ctx), [{ blocker: 'LG', target: 'WLB' }]);
});
test('T-162: cross-combo handoff, a claimed LB is never picked twice in one call', () => {
  const s = sw();
  s.ctx.side = 1;
  // playside combo (RT/RG on LDT, plan MLB's neighbour) and backside combo C/LG (plan WLB-side)
  const blk = (t) => ({ target: t, angle: 'straight', engaged: true, seq: 1, held: HELD });
  for (const [id, x] of [['RG', 1.5], ['RT', 3.3]]) { s.g(id).block = blk('LDT'); place(s, [[id, x, 24.3]]); }
  s.ctx.combos = [
    { owner: 'C', partner: 'LG', target: 'RDT', watch: 'WLB' },
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
  ];
  for (const l of lbs(s)) place(s, [[l.id, 40, 40]]);
  // the backside combo's plan watch fits next to the playside combo and is the most dangerous
  place(s, [['WLB', 2.0, 25.5], ['MLB', -1.5, 26.5]]);
  const ball = { x: 2.0, y: 25 };
  const out = zoneSwitch(s.players, ball, s.ctx);
  const tgts = out.map((e) => e.target);
  assert.equal(new Set(tgts).size, tgts.length, 'no LB twice');
  assert.deepEqual(out.find((e) => ['RT', 'RG'].includes(e.blocker))?.target, 'WLB');
  assert.ok(out.every((e) => e.target !== 'WLB' || ['RT', 'RG'].includes(e.blocker)));
});
test('T-162: claimedSet and unclaimedInReach', () => {
  const s = sw();
  place(s, [['MLB', -1.3, 26], ['WLB', 30, 26]]);
  for (const l of lbs(s)) if (!['MLB', 'WLB'].includes(l.id)) place(s, [[l.id, 40, 40]]);
  const claimed = claimedSet(s.players, ['X']);
  assert.ok(claimed.has('RDT') && claimed.has('X'));
  assert.deepEqual(unclaimedInReach(s.players, { x: 0, y: 25 }, s.ctx, claimed, -1).map((d) => d.id), ['MLB']);
  assert.deepEqual(unclaimedInReach(s.players, null, s.ctx, new Set(['MLB']), -1), []);
});
test('T-162: a switched combo is never touched again; purity with a ball', () => {
  const s = sw();
  s.ctx.side = 1;
  place(s, [['MLB', -1.3, 25.0]]);
  s.g('C').block.target = 'MLB';
  assert.deepEqual(zoneSwitch(s.players, { x: 0, y: 25 }, s.ctx), []);
  s.g('C').block.target = 'RDT';
  const p0 = structuredClone(s.players);
  const c0 = structuredClone(s.ctx);
  zoneSwitch(s.players, { x: 0, y: 25 }, s.ctx);
  assert.deepEqual(s.players, p0);
  assert.deepEqual(s.ctx, c0);
});

// ---- F-54 #5 / R-5 ----
const planWith = (name, personnel, opts) => {
  const players = frontPlayers(name, personnel);
  return zonePlan(players, frontNumbers(players), LOS, opts);
};

test('F-54 #5 R-5: plain inside zone blocks the backside end', () => {
  const plan = planWith('base', 'te');
  assert.equal(plan.blocks.TE, 'LDE');
  assert.equal(plan.accounted.LDE.how, 'block');
  assert.equal(plan.accounted.SLB.how, 'free');
  const play = createPlay(25, 'insideZone', { personnel: 'te' });
  assert.ok(play.snap());
  assert.equal(play.player('TE').block.target, 'LDE');
});

test('F-54 #5 the backside end man is blocked on every front', () => {
  eachFront(({ label, front, players, numbers }) => {
    const plan = zonePlan(players, numbers, LOS);
    // an end man shaded outside the surface (cover null, e.g. dlPlus4 LDE) is covered by nobody, so only an edge inside the surface is blocked
    const edge = front.defenders.find((d) => d.id === front.edge);
    if (edge && edge.cover != null) assert.equal(plan.accounted[front.edge].how, 'block', `${label} edge`);
    const ids = front.defenders.map((d) => d.id);
    assert.deepEqual(Object.keys(plan.accounted).sort(), [...ids].sort(), `${label} one entry each`);
    const lineBlockers = front.line.length;
    if (lineBlockers < front.defenders.length) {
      for (const [id, a] of Object.entries(plan.accounted)) {
        // a line defender outside the surface (cover null) is covered by nobody, as in F-36 #6
        const d = front.defenders.find((x) => x.id === id);
        if (a.how === 'free') assert.ok(d.level === 'second' || d.cover == null, `${label} free ${id} is second-level or outside the surface`);
      }
    }
  });
});

test('F-54 #5 ZONE_READ leaves the end to the QB', () => {
  let fired = 0;
  eachFront(({ label, front, players, numbers, plan }) => {
    const read = zonePlan(players, numbers, LOS, { scheme: ZONE_READ });
    const end = front.line[front.line.length - 1];
    if (sparedEdge(front, read)) {
      fired++;
      assert.equal(read.accounted[front.edge].how, 'read', label);
      assert.deepEqual(read.accounted[front.edge].by, [], label);
      assert.equal(read.techs[end.id].tech, 'climb', label);
    } else if (front.defenders.find((d) => d.id === front.edge)?.cover != null) {
      assert.equal(read.accounted[front.edge].how, 'block', label);
    }
  });
  assert.ok(fired > 0);
  for (const [name, personnel] of [['under43', 'noTe'], ['bear', 'noTe'], ['base', 'te']]) {
    const read = planWith(name, personnel, { scheme: ZONE_READ });
    const f = read.front;
    assert.equal(read.accounted[f.edge].how, 'read', `${personnel} ${name}`);
    assert.equal(read.techs[f.line[f.line.length - 1].id].tech, 'climb', `${personnel} ${name}`);
  }
  // plain inside zone on those fronts blocks him
  for (const [name, personnel] of [['under43', 'noTe'], ['bear', 'noTe'], ['base', 'te']]) {
    const plan = planWith(name, personnel);
    assert.equal(plan.accounted[plan.front.edge].how, 'block', `${personnel} ${name}`);
  }
});

test('F-54 #5 the box argument', () => {
  const full = planWith('base', 'te');
  const box = ['LDE', 'MLB', 'GHOST'];
  const sub = planWith('base', 'te', { box });
  assert.deepEqual(Object.keys(sub.accounted).sort(), [...box].sort());
  assert.equal(sub.accounted.LDE.how, 'block');
  assert.equal(sub.accounted.GHOST.how, 'free'); // not numbered by runScheme
  assert.deepEqual(sub.accounted.MLB, full.accounted.MLB);
  assert.deepEqual(sub.blocks, full.blocks);
});

test('F-54 #2 tightened: no line-level defender inside the surface goes unblocked', () => {
  eachFront(({ label, front, plan }) => {
    const vals = Object.values(plan.blocks);
    for (const d of front.defenders.filter((x) => x.level === 'line' && x.cover != null)) {
      assert.ok(vals.includes(d.id), `${label} ${d.id}`);
    }
  });
});
