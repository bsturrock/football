import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zonePlan, zoneSwitch, SWITCH_DIST, INSIDE_ZONE } from '../src/dots/zone.js';
import { RULES, CLIMB_REACH } from '../src/dots/assign.js';
import { readFront, HEAD_UP } from '../src/dots/front.js';
import { LOS, FRONT_NAMES, frontPlayers, frontNumbers } from './fixtures/fronts.js';
import { buildLineup, PLAYS } from '../src/dots/roster.js';
import { LB_SHIFT_STEP } from '../src/dots/play.js';
import { IZ_FREE, LB_MINUS6_RG_WATCH } from './fixtures/base-front.js';

test('scheme flag on insideZone', () => assert.equal(PLAYS.insideZone.scheme, 'zone'));

const T = (tech, shade, watch = null) => ({ tech, shade, watch });
const EXPECTED = {
  base: {
    blocks: { LT: 'RDE', LG: 'RDE', C: 'RDT', RG: 'LDT', RT: 'LDT' },
    combos: [
      { owner: 'RT', partner: 'RG', target: 'LDT', watch: 'MLB' },
      { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
    ],
    techs: {
      LT: T('combo', 'playside', 'WLB'), LG: T('combo', 'none', 'WLB'), C: T('zone', 'playside'),
      RG: T('combo', 'playside', 'MLB'), RT: T('combo', 'none', 'MLB'),
    },
    free: IZ_FREE.base,
  },
  dlPlus4: {
    blocks: { LT: 'WLB', LG: 'RDE', C: 'RDT', RG: 'RDT', RT: 'LDT' },
    combos: [{ owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' }],
    techs: {
      LT: T('climb', 'none'), LG: T('zone', 'playside'), C: T('combo', 'head', 'MLB'),
      RG: T('combo', 'none', 'MLB'), RT: T('cutoff', 'playside'),
    },
    free: IZ_FREE.dlPlus4,
  },
  dlMinus4: {
    blocks: { LT: 'RDE', LG: 'RDT', C: 'LDT', RG: 'LDT', RT: 'LDE' },
    combos: [{ owner: 'RG', partner: 'C', target: 'LDT', watch: 'MLB' }],
    techs: {
      LT: T('zone', 'playside'), LG: T('zone', 'playside'), C: T('combo', 'head', 'MLB'),
      RG: T('combo', 'none', 'MLB'), RT: T('cutoff', 'playside'),
    },
    free: IZ_FREE.dlMinus4,
  },
  over43: {
    blocks: { LT: 'PE', LG: 'PT', C: 'PT', RG: 'BT', RT: 'BT' },
    combos: [
      { owner: 'RT', partner: 'RG', target: 'BT', watch: 'WIL' },
      { owner: 'C', partner: 'LG', target: 'PT', watch: 'MIK' },
    ],
    techs: {
      LT: T('zone', 'playside'), LG: T('combo', 'playside', 'MIK'), C: T('combo', 'none', 'MIK'),
      RG: T('combo', 'playside', 'WIL'), RT: T('combo', 'none', 'WIL'),
    },
    free: ['SAM', 'BE'],
  },
  under43: {
    blocks: { LT: 'PE', LG: 'PE', C: 'PN', RG: 'PN', RT: 'BT' },
    combos: [
      { owner: 'RG', partner: 'C', target: 'PN', watch: 'L2' },
      { owner: 'LG', partner: 'LT', target: 'PE', watch: 'L1' },
    ],
    techs: {
      LT: T('combo', 'playside', 'L1'), LG: T('combo', 'none', 'L1'), C: T('combo', 'playside', 'L2'),
      RG: T('combo', 'none', 'L2'), RT: T('cutoff', 'playside'),
    },
    free: ['L3', 'BE'],
  },
  odd34: {
    blocks: { LT: 'PO', LG: 'PE', C: 'N', RG: 'N', RT: 'BE' },
    combos: [{ owner: 'RG', partner: 'C', target: 'N', watch: 'BI' }],
    techs: {
      LT: T('zone', 'playside'), LG: T('zone', 'playside'), C: T('combo', 'head', 'BI'),
      RG: T('combo', 'none', 'BI'), RT: T('cutoff', 'none'),
    },
    free: ['PI', 'BO'],
  },
  bear: {
    blocks: { LT: 'PE', LG: 'P3', C: 'N', RG: 'N', RT: 'B3' },
    combos: [{ owner: 'RG', partner: 'C', target: 'N', watch: 'L2' }],
    techs: {
      LT: T('zone', 'playside'), LG: T('zone', 'playside'), C: T('combo', 'head', 'L2'),
      RG: T('combo', 'none', 'L2'), RT: T('cutoff', 'playside'),
    },
    free: ['L1', 'BE'],
  },
  walkedUp: {
    blocks: { LT: 'SAM', LG: 'PE', C: 'PT', RG: 'BT', RT: 'BT' },
    combos: [{ owner: 'RT', partner: 'RG', target: 'BT', watch: 'WIL' }],
    techs: {
      LT: T('zone', 'playside'), LG: T('zone', 'playside'), C: T('zone', 'playside'),
      RG: T('combo', 'playside', 'WIL'), RT: T('combo', 'none', 'WIL'),
    },
    free: ['MIK', 'BE'],
  },
};
EXPECTED.lbPlus6 = EXPECTED.base;
EXPECTED.lbMinus6 = {
  blocks: EXPECTED.base.blocks,
  combos: [
    { owner: 'RT', partner: 'RG', target: 'LDT', watch: LB_MINUS6_RG_WATCH },
    { owner: 'LG', partner: 'LT', target: 'RDE', watch: 'WLB' },
  ],
  techs: { ...EXPECTED.base.techs, RG: T('combo', 'playside', LB_MINUS6_RG_WATCH), RT: T('combo', 'none', LB_MINUS6_RG_WATCH) },
  free: IZ_FREE.lbMinus6,
};
EXPECTED.backedOff = {
  blocks: { LT: 'PE', LG: 'PE', C: 'PN', RG: 'PN', RT: 'L3' },
  combos: EXPECTED.under43.combos,
  techs: { ...EXPECTED.under43.techs, RT: T('climb', 'none') },
  free: ['BT', 'BE'],
};

const planOf = (name, players = frontPlayers(name)) => zonePlan(players, frontNumbers(players), LOS);

test('every front gets the agreed plan', () => {
  assert.deepEqual([...FRONT_NAMES].sort(), Object.keys(EXPECTED).sort());
  for (const name of FRONT_NAMES) {
    assert.deepEqual(planOf(name), { side: -1, ...EXPECTED[name] }, name);
  }
});

test('every rule row names a registered rule', () => {
  for (const r of INSIDE_ZONE.rules) assert.ok(Object.hasOwn(RULES, r.when), r.when);
});

test('invariants over all fronts', () => {
  for (const name of FRONT_NAMES) {
    const players = frontPlayers(name);
    const numbers = frontNumbers(players);
    const front = readFront(players, numbers, LOS);
    const r = zonePlan(players, numbers, LOS);
    const lineDef = front.defenders.filter((d) => d.level === 'line');
    const uBack = front.line[front.line.length - 1].u;
    const vals = Object.values(r.blocks);
    // (a) every line defender at or playside of the backside end is blocked
    for (const d of lineDef) {
      if (d.u >= uBack - HEAD_UP) assert.ok(vals.includes(d.id), `${name} (a) ${d.id}`);
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
      assert.deepEqual(zonePlan(moved, numbers, LOS), r, `${name} nudge ${nudge}`);
    }
    assert.deepEqual(zonePlan([...players].reverse(), numbers, LOS), r, `${name} reversed`);
    const p0 = structuredClone(players);
    const n0 = structuredClone(numbers);
    zonePlan(players, numbers, LOS);
    assert.deepEqual(players, p0);
    assert.deepEqual(numbers, n0);
  }
});

const sw = () => {
  const players = buildLineup(25, 'insideZone', { lbShift: -6 * LB_SHIFT_STEP });
  const g = (id) => players.find((p) => p.id === id);
  const blk = { target: 'RDT', angle: 'straight', engaged: true, seq: 1 };
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
test('F-19 #8: committed, MLB out of range, commit past pair picks LG', () =>
  assert.deepEqual(at(-1.6, 29.5, commit('MLB', -1.5)), [{ blocker: 'LG', target: 'MLB' }]));
test('F-19 #8: committed toward near side picks C', () =>
  assert.deepEqual(at(-1.6, 29.5, commit('MLB', 0.4)), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8: committed lateral tie goes to owner', () =>
  assert.deepEqual(at(-1.6, 29.5, commit('MLB', -1.1)), [{ blocker: 'C', target: 'MLB' }]));
test('F-19 #8: commit beats range', () =>
  assert.deepEqual(at(-1.3, 25.0, commit('MLB', 0.4)), [{ blocker: 'C', target: 'MLB' }]));
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
