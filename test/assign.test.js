import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFront, HEAD_UP } from '../src/dots/front.js';
import { runScheme, CLIMB_REACH } from '../src/dots/assign.js';
import { zonePlan, INSIDE_ZONE } from '../src/dots/zone.js';
import { A_GAP_HALF, numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';
import { frontPlayers, frontNumbers, LOS, FRONT_NAMES } from './fixtures/fronts.js';
import { IZ_FREE, IZ_PLAN_PINS } from './fixtures/base-front.js';

const read = (name) => {
  const players = frontPlayers(name);
  return readFront(players, frontNumbers(players), LOS);
};
const IZ = { rules: [
  { when: 'covered', at: 'backEnd', tech: 'cutoff' }, { when: 'covered', tech: 'zone' },
  { when: 'double', tech: 'combo' }, { when: 'climb', tech: 'climb' }, { when: 'cutoff', tech: 'cutoff' },
] };

test('runScheme with the IZ table matches zonePlan on every front and personnel', () => {
  for (const name of FRONT_NAMES) {
    for (const personnel of ['noTe', 'te']) {
      const players = frontPlayers(name, personnel);
      const numbers = frontNumbers(players);
      const { front, ...plan } = zonePlan(players, numbers, LOS);
      // F-54: runScheme also returns mike and pairs; compare every key both results have
      const got = runScheme(readFront(players, numbers, LOS), INSIDE_ZONE);
      for (const k of Object.keys(plan)) if (k in got) assert.deepEqual(got[k], plan[k], `${name} ${personnel} ${k}`);
      for (const k of ['side', 'blocks', 'techs', 'combos', 'free']) assert.ok(k in got, k);
    }
  }
});

// F-54 #3: the RDE sits outside LG, toward the uncovered LT, so LT helps LG instead of climbing
test('playside end helps when the DL shades toward him, dlPlus4', () => {
  const r = runScheme(read('dlPlus4'), IZ);
  assert.equal(r.blocks.LT, 'RDE');
  assert.deepEqual(r.techs.LT, { tech: 'combo', shade: 'none', watch: 'WLB' });
  assert.equal(r.blocks.RT, 'LDT');
  assert.deepEqual(r.techs.RT, { tech: 'cutoff', shade: 'playside', watch: null });
  assert.equal(r.blocks.RG, 'RDT');
  assert.deepEqual(r.combos, [
    { owner: 'RG', partner: 'C', target: 'RDT', watch: 'MLB' },
    { owner: 'LT', partner: 'LG', target: 'RDE', watch: 'WLB' },
  ]);
  assert.deepEqual(r.free, IZ_FREE.dlPlus4);
});

test('at filtering and first-match order', () => {
  const f = read('base');
  const r = runScheme(f, { rules: [
    { when: 'covered', at: 'playEnd', tech: 'X' }, { when: 'covered', tech: 'Y' },
  ] });
  const open = Object.keys(f.covered).filter((id) => f.covered[id].length === 0);
  assert.equal(open.length, 1);
  assert.equal(r.techs.LT.tech, 'X');
  for (const id of Object.keys(f.covered)) {
    if (f.covered[id].length > 0 && id !== 'LT') assert.equal(r.techs[id].tech, 'Y', id);
  }
  for (const [id, t] of Object.entries(r.techs)) {
    if (id !== 'LT') assert.equal(t.tech, 'Y', id);
  }
  const [uncovered] = open;
  assert.ok(!(uncovered in r.techs));
  assert.ok(!(uncovered in r.blocks));
});

test('purity', () => {
  const f = read('base');
  const f0 = structuredClone(f);
  const s0 = structuredClone(IZ);
  runScheme(f, IZ);
  assert.deepEqual(f, f0);
  assert.deepEqual(IZ, s0);
});

test('unknown rule throws even when earlier rows match', () => {
  const bad = { rules: [{ when: 'covered', tech: 'zone' }, { when: 'nope', tech: 'zone' }] };
  assert.throws(() => runScheme(read('base'), bad), /unknown rule "nope"/);
  assert.throws(() => runScheme(read('base'), { rules: [{ when: 'nope', tech: 'zone' }] }), /unknown rule/);
});

// F-54 #3: BT sits on RG's playside shoulder (toward the C), so C helps RG on BT (ace); before, C doubled LG's PT
test('R-63: over43/walkedUp te: RT climbs, C and RG ace the BT', () => {
  for (const name of ['over43', 'walkedUp']) {
    const players = frontPlayers(name, 'te');
    const f = readFront(players, frontNumbers(players), LOS);
    const r = runScheme(f, IZ);
    assert.equal(r.blocks.RT, 'WIL', name);
    assert.equal(r.techs.RT.tech, 'climb', name);
    assert.equal(r.blocks.RG, 'BT', name);
    assert.deepEqual(r.combos.map((c) => [c.owner, c.partner, c.target]), [['C', 'RG', 'BT']], name);
    assert.deepEqual(r.pairs.map((p) => p.name), ['ace'], name);
  }
});

// F-54 #3: a combo's man sits between the two linemen or head-up on the covered one (shaded toward the helper)
test('every combo target is between the pair or head-up on the covered man', () => {
  for (const name of FRONT_NAMES) {
    for (const personnel of ['noTe', 'te']) {
      const players = frontPlayers(name, personnel);
      const f = readFront(players, frontNumbers(players), LOS);
      for (const c of runScheme(f, IZ).combos) {
        const tgt = f.defenders.find((d) => d.id === c.target);
        const nb = f.line.find((l) => l.id === c.partner);
        const ow = f.line.find((l) => l.id === c.owner);
        const lo = Math.min(nb.u, ow.u) - HEAD_UP;
        const hi = Math.max(nb.u, ow.u) + HEAD_UP;
        assert.ok(tgt.u >= lo && tgt.u <= hi, `${name} ${personnel} ${c.owner}/${c.partner}`);
      }
    }
  }
});

test('spare: a man-short line leaves the backside end man and the end lineman climbs', () => {
  const SP = { rules: [{ when: 'spare', at: 'backEnd', tech: 'climb' }, ...IZ.rules] };
  const climbs = [];
  for (const name of ['under43', 'bear', 'base', 'over43', 'odd34']) {
    const players = frontPlayers(name, 'te');
    const f = readFront(players, frontNumbers(players), LOS);
    const r = runScheme(f, SP);
    const end = f.line.at(-1).id;
    const tgt = f.defenders.find((d) => d.id === r.blocks[end]);
    if (tgt && tgt.level === 'second') {
      climbs.push(name);
      assert.ok(r.free.includes(f.edge), name);
      assert.equal(r.techs[end].tech, 'climb', name);
    } else {
      assert.equal(r.blocks[end], f.edge, name);
    }
  }
  for (const name of ['under43', 'bear', 'base']) assert.ok(climbs.includes(name), name);
  for (const name of ['over43', 'odd34']) assert.ok(!climbs.includes(name), name);
});

test('purity with the spare table', () => {
  const SP = { rules: [{ when: 'spare', at: 'backEnd', tech: 'climb' }, ...IZ.rules] };
  for (const name of FRONT_NAMES) {
    const players = frontPlayers(name, 'te');
    const f = readFront(players, frontNumbers(players), LOS);
    const f0 = structuredClone(f);
    runScheme(f, SP);
    assert.deepEqual(f, f0, name);
  }
});

// ---- F-54 #2 #3 #4 ----
const MIRRORS = [1, -1];
// A hand-built lineup: the real offense (x negated when mirror is -1) against defenders given as [id, x, depth] at the
// offense's right-hand spec position (also negated). Mirroring keeps ids on the same roles, so pairs by id are unchanged.
function handFront(personnel, mirror, defs, playside) {
  const off = buildLineup(LOS, 'insideZone', { personnel }).filter((p) => p.team === 'offense')
    .map((p) => ({ ...p, x: mirror * p.x }));
  const def = defs.map(([id, x, depth]) => ({
    id, name: id, team: 'defense', role: depth > 2 ? 'LB' : 'DT', x: mirror * x, y: LOS + depth, speed: 6, strength: 1,
  }));
  const players = [...off, ...def];
  const ps = mirror === 1 ? playside : (playside === 'right' ? 'left' : 'right');
  const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: ps });
  return readFront(players, numbers, LOS);
}
const pairKey = (p) => `${p.name}:${[p.owner, p.partner].sort().join('+')}`;
const pairSet = (r) => r.pairs.map(pairKey).sort();

test('F-54 #3 spec nickel pairs both directions', () => {
  // te personnel, TE right, playside right; positions at the spec's right-hand alignment
  const defs = [
    ['D5', -2.4 - 0.25, 0.6], ['D1', -0.25, 0.6], ['D3', 1.2 + 0.25, 0.6], ['D9', 3.6 + 0.7, 0.6],
    ['MIKE', 1.0, 4.5], ['WILL', -1.8, 4.5],
  ];
  for (const m of MIRRORS) {
    const r = runScheme(handFront('te', m, defs, 'right'), INSIDE_ZONE);
    const tag = `mirror ${m}`;
    assert.deepEqual(pairSet(r), ['ace:C+LG', 'deuce:RG+RT'], tag);
    assert.equal(r.blocks.TE, 'D9', tag);
    assert.equal(r.blocks.LT, 'D5', tag);
    assert.equal(r.techs.LT.tech, 'cutoff', tag);
    for (const c of r.combos) assert.equal(c.target, c.owner === 'C' || c.owner === 'LG' ? 'D1' : 'D3', tag);
    assert.equal(r.mike, 'MIKE', tag);
    const watchOf = (name) => r.combos[r.pairs.findIndex((p) => p.name === name)].watch;
    assert.equal(watchOf('deuce'), 'MIKE', tag);
    assert.equal(watchOf('ace'), 'WILL', tag);
  }
});

test('F-54 #3 tite pairs both directions', () => {
  const defs = [
    ['N', 0, 0.6], ['PQ', 2.15, 0.6], ['BQ', -2.15, 0.6], ['L1', 1.2, 4.5], ['L2', -1.2, 4.5],
  ];
  const want = {
    right: ['ace:C+LG', 'deuce:RG+RT'],
    left: ['ace:C+RG', 'deuce:LG+LT'],
  };
  for (const personnel of ['noTe', 'te']) {
    for (const playside of ['right', 'left']) {
      for (const m of MIRRORS) {
        const r = runScheme(handFront(personnel, m, defs, playside), INSIDE_ZONE);
        const tag = `${personnel} ${playside} mirror ${m}`;
        assert.deepEqual(pairSet(r), want[playside], tag);
        const alone = playside === 'right' ? 'LT' : 'RT';
        assert.ok(!r.pairs.some((p) => p.owner === alone || p.partner === alone), tag);
        assert.ok(r.blocks[alone] != null, tag);
      }
    }
  }
});

test('F-54 #3 pair names', () => {
  // pairs come from the nickel (ace, deuce) and a TE tite (tag needs tackle + TE)
  const nick = runScheme(handFront('te', 1, [
    ['D5', -2.65, 0.6], ['D1', -0.25, 0.6], ['D3', 1.45, 0.6], ['D9', 4.3, 0.6], ['MIKE', 1.0, 4.5], ['WILL', -1.8, 4.5],
  ], 'right'), INSIDE_ZONE);
  assert.deepEqual(nick.pairs.map((p) => p.name).sort(), ['ace', 'deuce']);
  // a 5-tech outside the TE with the TE shaded down to the tackle: tackle + TE on the 7
  const tag = runScheme(handFront('te', 1, [
    ['D7', 3.6 - 0.25, 0.6], ['N', 0, 0.6], ['D5', -2.65, 0.6], ['MIKE', 1.0, 4.5], ['WILL', -1.8, 4.5],
  ], 'right'), INSIDE_ZONE);
  assert.ok(tag.pairs.every((p) => ['ace', 'deuce', 'tag', 'combo'].includes(p.name)));
  for (const p of tag.pairs) {
    const ids = [p.owner, p.partner].sort().join('+');
    const expect = { 'C+LG': 'ace', 'C+RG': 'ace', 'LG+LT': 'deuce', 'RG+RT': 'deuce', 'RT+TE': 'tag' }[ids] || 'combo';
    assert.equal(p.name, expect, ids);
  }
});

test('F-54 #3 every front pairs, playside left', () => {
  const E = (owner, partner, target) => `${owner}+${partner}>${target}`;
  const pinPairs = (personnel) => IZ_PLAN_PINS[personnel].base.combos.map((c) => E(c.owner, c.partner, c.target));
  const want = {
    // base pairs come from the shared base plan pins (test/fixtures/base-front.js IZ_PLAN_PINS), so a change to who is covered is restated in one place
    // RDT sits between LG and C, shaded toward C: C helps LG (playside first); RG's LDT is also toward C but C is taken
    base: { noTe: pinPairs('noTe'), te: pinPairs('te') },
    // RDE is outside LG, toward the uncovered LT: LT helps LG; RDT is head-up on C, LG is covered, so RG (backside) helps C
    dlPlus4: { both: [E('LT', 'LG', 'RDE'), E('RG', 'C', 'RDT')] },
    // RDT is outside LG, toward the uncovered LT: LT helps LG; LDT is head-up on C, so RG helps C; the TE (last man) never combos
    dlMinus4: { both: [E('LT', 'LG', 'RDT'), E('RG', 'C', 'LDT')] },
    // lbPlus6 and lbMinus6 shift only linebackers, so their line alignment and pairs equal base
    lbPlus6: { noTe: pinPairs('noTe'), te: pinPairs('te') },
    lbMinus6: { noTe: pinPairs('noTe'), te: pinPairs('te') },
    // BT is on the C's backside shoulder, toward the C: C helps RG; PT is outside LG, away from the C, and LT is covered
    over43: { both: [E('C', 'RG', 'BT')] },
    // PN is between LG and C: LG helps C (ace); BT is toward RG so RG helps RT (deuce) when RT is not the last man (te)
    under43: { noTe: [E('LG', 'C', 'PN')], te: [E('LG', 'C', 'PN'), E('RG', 'RT', 'BT')] },
    // nose head-up on C: LG (playside) helps; RT/RG have no covered neighbour to help
    odd34: { both: [E('LG', 'C', 'N')] },
    // nose head-up on C, LG is covered; noTe: RG is handed RT's inner man B3 (hand-in) so C blocks alone; te: RG helps C
    bear: { noTe: [], te: [E('RG', 'C', 'N')] },
    // same as over43 (SAM is second level)
    walkedUp: { both: [E('C', 'RG', 'BT')] },
    // PN is between LG and C: LG helps C
    backedOff: { both: [E('LG', 'C', 'PN')] },
  };
  for (const name of FRONT_NAMES) {
    for (const personnel of ['noTe', 'te']) {
      const players = frontPlayers(name, personnel);
      const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
      const r = runScheme(readFront(players, numbers, LOS), INSIDE_ZONE);
      const exp = want[name][personnel] || want[name].both;
      const got = r.combos.map((c) => `${c.owner}+${c.partner}>${c.target}`).sort();
      assert.deepEqual(got, [...exp].sort(), `${name} ${personnel}`);
    }
  }
});

const BOTH = [['noTe', 'right'], ['noTe', 'left'], ['te', 'right'], ['te', 'left']];
function eachFront(fn) {
  for (const name of FRONT_NAMES) {
    for (const [personnel, playside] of BOTH) {
      const players = frontPlayers(name, personnel);
      const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside });
      fn(readFront(players, numbers, LOS), `${name} ${personnel} ${playside}`);
    }
  }
}

test('F-54 #4 Mike and watches', () => {
  const nick = runScheme(handFront('te', 1, [
    ['D5', -2.65, 0.6], ['D1', -0.25, 0.6], ['D3', 1.45, 0.6], ['D9', 4.3, 0.6], ['MIKE', 1.0, 4.5], ['WILL', -1.8, 4.5],
  ], 'right'), INSIDE_ZONE);
  assert.equal(nick.mike, 'MIKE');
  assert.equal(runScheme(handFront('te', 1, [['D3', 1.45, 0.6]], 'right'), INSIDE_ZONE).mike, null);

  eachFront((f, tag) => {
    const r = runScheme(f, INSIDE_ZONE);
    const seconds = f.defenders.filter((d) => d.level === 'second');
    if (!seconds.length) { assert.equal(r.mike, null, tag); return; }
    const gapX = f.centerX + f.side * A_GAP_HALF;
    const near = Math.min(...seconds.map((d) => Math.abs(d.x - gapX)));
    assert.equal(Math.abs(f.defenders.find((d) => d.id === r.mike).x - gapX), near, tag);
    const watches = r.combos.map((c) => c.watch).filter((w) => w != null);
    assert.equal(new Set(watches).size, watches.length, `${tag} distinct`);
    const ulb = (id) => f.defenders.find((d) => d.id === id).u;
    // combos in playside-first order never watch a more backside LB than a later (more backside) combo
    const mid = (c) => (f.line.find((l) => l.id === c.owner).u + f.line.find((l) => l.id === c.partner).u) / 2;
    const ordered = r.combos.filter((c) => c.watch != null).sort((a, b) => mid(b) - mid(a));
    for (let k = 1; k < ordered.length; k++) {
      assert.ok(ulb(ordered[k - 1].watch) >= ulb(ordered[k].watch), `${tag} lateral order`);
    }
    // Mike is watched or climbed to when a combo or climber is within reach of him
    const mk = f.defenders.find((d) => d.id === r.mike);
    const units = [
      ...r.combos.map((c) => (f.line.find((l) => l.id === c.owner).x + f.line.find((l) => l.id === c.partner).x) / 2),
      ...f.line.filter((l) => r.techs[l.id]?.tech === 'climb').map((l) => l.x),
    ];
    if (units.some((x) => Math.abs(x - mk.x) <= CLIMB_REACH)) {
      const taken = new Set([...watches, ...f.line.map((l) => r.blocks[l.id])]);
      assert.ok(taken.has(r.mike), `${tag} mike accounted`);
    }
  });
});

test('F-54 #2 every line defender inside the surface is the target of exactly one block group and no lineman is on two DL', () => {
  eachFront((f, tag) => {
    const r = runScheme(f, INSIDE_ZONE);
    for (const d of f.defenders) {
      if (d.level !== 'line' || d.cover == null || d.id === f.edge) continue;
      const blockers = f.line.filter((l) => r.blocks[l.id] === d.id).map((l) => l.id).sort();
      assert.ok(blockers.length >= 1, `${tag} ${d.id} unblocked`);
      if (blockers.length > 1) {
        const groups = r.combos.filter((c) => c.target === d.id);
        assert.equal(groups.length, 1, `${tag} ${d.id}`);
        assert.deepEqual([groups[0].owner, groups[0].partner].sort(), blockers, `${tag} ${d.id}`);
      }
    }
    const seen = new Set();
    for (const c of r.combos) {
      for (const id of [c.owner, c.partner]) {
        assert.ok(!seen.has(id), `${tag} ${id} in two combos`);
        seen.add(id);
        assert.equal(r.blocks[id], c.target, `${tag} ${id} on one DL`);
      }
    }
  });
});
