import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonePlan, zoneSwitch, pickClimber, SWITCH_DIST, COMBO_HOLD, INSIDE_ZONE } from '../src/dots/zone.js';
import { RULES, CLIMB_REACH } from '../src/dots/assign.js';
import { readFront, HEAD_UP } from '../src/dots/front.js';
import { LOS, FRONT_NAMES, frontPlayers, frontNumbers } from './fixtures/fronts.js';
import { buildLineup, PLAYS, FRONTS } from '../src/dots/roster.js';
import { LB_SHIFT_STEP, DL_SHIFT_STEP } from '../src/dots/play.js';
import { numberPlay, A_GAP_HALF } from '../src/dots/numbering.js';
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

const eachFront = (fn) => {
  for (const personnel of PERSONNELS) {
    for (const name of FRONT_NAMES) {
      const players = frontPlayers(name, personnel);
      const numbers = frontNumbers(players);
      const front = readFront(players, numbers, LOS);
      fn({ label: `${personnel} ${name}`, personnel, name, players, numbers, front, plan: withoutFront(zonePlan(players, numbers, LOS)) });
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

test('F-36 #3: the backside end man is blocked, and every covered line man is a target', () => {
  eachFront(({ label, personnel, front, plan }) => {
    const targets = Object.values(plan.blocks);
    const edge = front.defenders.find((d) => d.id === front.edge);
    if (edge && edge.cover != null) assert.ok(targets.includes(edge.id), `${label} edge`);
    if (personnel === 'te') assert.ok(targets.includes(front.edge), `${label} edge blocked`);
  });
});

test('F-36 #5: second-level men are taken in zone count order', () => {
  const key = (d) => (d.n >= 0 ? [0, d.n] : [1, -d.n]);
  const less = (a, b) => (key(a)[0] - key(b)[0]) || (key(a)[1] - key(b)[1]);
  eachFront(({ label, front, plan }) => {
    const second = front.defenders.filter((d) => d.level === 'second');
    const seen = new Set();
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
    for (const { id, ref } of picks) {
      const best = second
        .filter((d) => !seen.has(d.id) && Math.abs(d.x - ref) <= CLIMB_REACH)
        .sort((a, b) => less(a, b) || (Math.abs(a.x - ref) - Math.abs(b.x - ref)) || (a.id < b.id ? -1 : 1))[0];
      assert.equal(id, best.id, `${label} pick`);
      seen.add(id);
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
      assert.ok(d.level === 'second' || d.cover == null, `${label} free ${id}`);
    }
    if (personnel === 'te') assert.equal(plan.free.length, 1, label);
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

const sw = () => {
  const players = buildLineup(25, 'insideZone', { lbShift: -6 * LB_SHIFT_STEP });
  const g = (id) => players.find((p) => p.id === id);
  const blk = { target: 'RDT', angle: 'straight', engaged: true, seq: 1, held: COMBO_HOLD };
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

const commit = (id, x) => (s) => { s.ctx.committed = { [id]: { x, t: 0.35 } }; };
test('F-19 #8: committed, MLB out of range, fit past pair picks LG', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { commit('MLB', -1.5)(s); s.ctx.defGoals = { MLB: { x: -1.5 } }; }), [{ blocker: 'LG', target: 'MLB' }]));
test('F-19 #8: the commit only triggers; the fit (defGoals) picks the climber', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { commit('MLB', -1.5)(s); s.ctx.defGoals = { MLB: { x: 0.4 } }; }), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8: commit with no goal falls back to the watch position', () =>
  assert.deepEqual(at(-1.6, 29.5, commit('MLB', 0.4)), [{ blocker: 'LG', target: 'MLB' }]));
test('F-19 #8: fit lateral tie goes to owner', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { commit('MLB', 0)(s); s.ctx.defGoals = { MLB: { x: -1.1 } }; }), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8: commit beats range', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { commit('MLB', 0.4)(s); s.ctx.defGoals = { MLB: { x: 0.4 } }; }), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8: commit for another id does not trigger', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => { s.ctx.committed = { WLB: { x: -1.5, t: 0 } }; }), []));
test('F-19 #8: null committed uses range rule', () => {
  assert.deepEqual(at(-1.6, 29.5, (s) => { s.ctx.committed = null; }), []);
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.ctx.committed = null; }), [{ blocker: 'LG', target: 'MLB' }]);
});
test('F-19 #8: already switched with commit -> none', () =>
  assert.deepEqual(at(-1.6, 29.5, (s) => {
    s.g('C').block.target = 'MLB';
    s.ctx.committed = { MLB: { x: 0.4, t: 0.35 } };
  }), []));
test('F-19 #8: purity with committed', () => {
  const { g, players, ctx } = sw();
  Object.assign(g('MLB'), { x: -1.6, y: 29.5 });
  ctx.committed = { MLB: { x: -1.5, t: 0.35 } };
  const p0 = structuredClone(players);
  const c0 = structuredClone(ctx);
  zoneSwitch(players, null, ctx);
  assert.deepEqual(players, p0);
  assert.deepEqual(ctx, c0);
});


const dl = (x) => ({ id: 'D', x });
const blkAt = (x) => ({ id: 'B' + x, x });
test('pickClimber: playside fit sends the playside blocker', () => {
  const [a, b] = [blkAt(-1), blkAt(1)];
  assert.equal(pickClimber(a, b, dl(0), 0.5, 1), b);
  assert.equal(pickClimber(a, b, dl(0), -0.5, -1), a);
});
test('pickClimber: backside fit sends the backside blocker', () => {
  const [a, b] = [blkAt(-1), blkAt(1)];
  assert.equal(pickClimber(b, a, dl(0), -0.5, 1), a);
  assert.equal(pickClimber(b, a, dl(0), 0.5, -1), b);
});
test('pickClimber: dead band goes to the nearer blocker, tie to the owner', () => {
  const [a, b] = [blkAt(-1), blkAt(1)];
  assert.equal(pickClimber(a, b, dl(0), 0.1, 1), b);
  assert.equal(pickClimber(a, b, dl(0), -0.1, 1), a);
  assert.equal(pickClimber(a, b, dl(0), 0, 1), a);
  assert.equal(pickClimber(b, a, dl(0), 0, 1), b);
});
test('pickClimber: bad side or missing DL falls back to nearest', () => {
  const [a, b] = [blkAt(-1), blkAt(1)];
  assert.equal(pickClimber(a, b, dl(0), 0.8, 0), b);
  assert.equal(pickClimber(a, b, null, 0.8, 1), b);
});
test('pickClimber: defGoals beats the watch position in zoneSwitch', () => {
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.ctx.defGoals = { MLB: { x: 0.2 } }; }), [{ blocker: 'C', target: 'MLB' }]);
  assert.deepEqual(at(0, 25.0, (s) => { s.ctx.defGoals = { MLB: { x: -2 } }; }), [{ blocker: 'LG', target: 'MLB' }]);
});
test('zoneSwitch: playside sign picks by the DL, not the nearer blocker', () => {
  // RDT sits at its lineup x; fit far playside (side +1) sends the more playside blocker even if the other is nearer
  const s = sw();
  Object.assign(s.g('RDT'), { x: -1.0 });
  Object.assign(s.g('MLB'), { x: -1.3, y: 25.0 });
  s.ctx.side = 1;
  s.ctx.defGoals = { MLB: { x: -0.2 } };
  assert.deepEqual(zoneSwitch(s.players, null, s.ctx), [{ blocker: 'C', target: 'MLB' }]);
  s.ctx.side = -1;
  s.ctx.defGoals = { MLB: { x: -1.8 } };
  assert.deepEqual(zoneSwitch(s.players, null, s.ctx), [{ blocker: 'LG', target: 'MLB' }]);
});

test('gate: stayer just engaged, climber held COMBO_HOLD -> switch', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.held = 0; }), [{ blocker: 'LG', target: 'MLB' }]));
test('gate: neither held long enough -> none', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.held = COMBO_HOLD - 0.01; s.g('LG').block.held = COMBO_HOLD - 0.01; }), []));
test('gate: stayer not engaged -> none', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('C').block.engaged = false; }), []));
test('gate: winning DL -> none', () =>
  assert.deepEqual(at(-1.3, 25.0, (s) => { s.g('RDT').react = { state: 'winning' }; }), []));
test('gate: commit trigger uses the same gate', () => {
  assert.deepEqual(at(-1.6, 29.5, (s) => { commit('MLB', -1.5)(s); s.g('C').block.held = 0; }), [{ blocker: 'LG', target: 'MLB' }]);
  assert.deepEqual(at(-1.6, 29.5, (s) => { commit('MLB', -1.5)(s); s.g('C').block.held = 0; s.g('LG').block.held = 0; }), []);
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
