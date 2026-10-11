import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REACTION_DELAY, HISTORY_S, TRACK_HALF, worldSnapshot, createPerception, observe, seenAt, velocityOf,
  techniqueOf, boxCount, cuesFor, perceiveAll,
} from '../src/dots/perceive.js';
import { buildLineup, FRONTS } from '../src/dots/roster.js';

const LOS = 25;
const SIDE = -1;
const DT = 1 / 60;
const P = (id, team, role, x, y, extra = {}) => ({ id, team, role, x, y, ...extra });
const snap = (t, players, contacts = [], carrierId = null) => ({ t, los: LOS, side: SIDE, carrierId, players, contacts });
const lineup = (opts, play = 'insideZone') => buildLineup(LOS, play, opts)
  .map((p) => ({ id: p.id, team: p.team, role: p.role, x: p.x, y: p.y }));
const lineupSnap = (opts, play) => snap(0, lineup(opts, play));
const CENTER = { centerId: 'C' };

function stateOf(players0, contacts = []) {
  return createPerception(snap(0, players0, contacts), CENTER);
}
// Feed frames t = k/60 where fn(k, tSeconds) returns the player list.
function run(players0, frames, fn, contacts = [], carrierId = null) {
  const st = createPerception(snap(0, players0, contacts, carrierId), CENTER);
  for (let k = 1; k <= frames; k++) observe(st, snap(k * DT, fn(k, k * DT), contacts, carrierId));
  return st;
}
const moved = (players, id, dx, dy) => players.map((p) => (p.id === id ? { ...p, x: p.x + dx, y: p.y + dy } : p));

// A bare line: center, two guards, two tackles, one LB, with no one else.
const baseLine = () => [
  P('LT', 'offense', 'OL', -2.4, 24.25), P('LG', 'offense', 'OL', -1.2, 24.4), P('C', 'offense', 'OL', 0, 24.72),
  P('RG', 'offense', 'OL', 1.2, 24.4), P('RT', 'offense', 'OL', 2.4, 24.25),
];

test('worldSnapshot copies fields and lists engaged contacts', () => {
  const live = [
    { id: 'A', team: 'offense', role: 'OL', x: 1, y: 2, vel: { x: 9, y: 9 }, reaction: 0.1, block: { engaged: true, target: 'D' } },
    { id: 'D', team: 'defense', role: 'DT', x: 1, y: 3, reaction: NaN, block: null },
    { id: 'B', team: 'offense', role: 'OL', x: 2, y: 2, block: { engaged: false, target: 'D' } },
  ];
  const s = worldSnapshot(live, { t: 0.5, los: LOS, side: SIDE, carrierId: 'Q' });
  assert.deepEqual(s.players[0], { id: 'A', team: 'offense', role: 'OL', x: 1, y: 2, reaction: 0.1 });
  assert.deepEqual(s.players[1], { id: 'D', team: 'defense', role: 'DT', x: 1, y: 3 });
  assert.deepEqual(s.contacts, [{ blocker: 'A', defender: 'D' }]);
  assert.equal(s.carrierId, 'Q');
});

const EXPECT_TECH = {
  base: { LDE: ['5', 'RT'], LDT: ['2i', 'RG'], RDT: ['2i', 'LG'], RDE: ['5', 'LT'] },
  over43: { PE: ['5', 'LT'], PT: ['3', 'LG'], BT: ['1', 'C'], BE: ['5', 'RT'] },
  under43: { PE: ['5', 'LT'], PN: ['1', 'C'], BT: ['3', 'RG'], BE: ['5', 'RT'] },
  odd34: { PO: ['9', 'LT'], PE: ['5', 'LT'], N: ['0', 'C'], BE: ['5', 'RT'], BO: ['9', 'TE'] },
  bear: { PE: ['7', 'LT'], P3: ['3', 'LG'], N: ['0', 'C'], B3: ['3', 'RG'], BE: ['7', 'TE'] },
  walkedUp: { SAM: ['6', 'LT'], PE: ['5', 'LT'], PT: ['3', 'LG'], BT: ['1', 'C'], BE: ['5', 'RT'] },
  backedOff: { PE: ['5', 'LT'], PN: ['1', 'C'], BE: ['5', 'RT'], BT: null },
};

test('technique labels per front', () => {
  for (const front of Object.keys(FRONTS)) {
    const s = lineupSnap({ front });
    for (const [id, want] of Object.entries(EXPECT_TECH[front] ?? {})) {
      const t = techniqueOf(s, id, CENTER);
      if (want === null) assert.equal(t, null, `${front} ${id}`);
      else {
        assert.equal(t.label, want[0], `${front} ${id} label`);
        assert.equal(t.blocker, want[1], `${front} ${id} blocker`);
      }
    }
  }
  assert.ok(Object.keys(EXPECT_TECH).every((k) => k in FRONTS));
  assert.equal(Object.keys(FRONTS).length, Object.keys(EXPECT_TECH).length);
});

test('line player tech cue on base', () => {
  const st = createPerception(lineupSnap({ front: 'base' }), CENTER);
  const rt = cuesFor(st, 'RT').tech;
  assert.equal(rt.id, 'LDE');
  assert.equal(rt.label, '5');
  assert.equal(rt.shade, 'backside');
  assert.equal(cuesFor(st, 'LG').tech.id, 'RDT');
  assert.equal(cuesFor(st, 'LG').tech.shade, 'backside');
  assert.equal(cuesFor(st, 'C').tech, null);
  assert.equal(cuesFor(st, 'MLB').tech, null);
  assert.equal(cuesFor(st, 'LDE').tech.blocker, 'RT');
});

test('box counts', () => {
  for (const front of Object.keys(FRONTS)) {
    const te = boxCount(lineupSnap({ front }));
    assert.equal(te.count, 7, `${front} te count`);
    assert.equal(te.blockers.length, 6, `${front} te blockers`);
    const no = boxCount(lineupSnap({ front, personnel: 'noTe' }));
    assert.equal(no.count, 7, `${front} noTe count`);
    assert.equal(no.blockers.length, 5, `${front} noTe blockers`);
  }
  const cases = [['11', 'nickel', 6, 6], ['12', 'base11', 7, 7], ['21', 'base11', 7, 6]];
  for (const [formation, defPersonnel, count, blockers] of cases) {
    const b = boxCount(lineupSnap({ formation, defPersonnel }));
    assert.equal(b.count, count, `${formation} ${defPersonnel} count`);
    assert.equal(b.blockers.length, blockers, `${formation} blockers`);
  }
  assert.ok(!boxCount(lineupSnap({ formation: '11', defPersonnel: 'nickel' })).ids.includes('NB'));
});

const trackWorld = (defs) => [P('T', 'offense', 'OL', 0, 24.4), P('C', 'offense', 'OL', -1.2, 24.4), ...defs];

test('track membership, order and lb', () => {
  const defs = [P('A', 'defense', 'DT', 1.0, 29), P('B', 'defense', 'DT', 2.0, 29), P('F', 'defense', 'LB', 0.5, 33),
    P('N', 'defense', 'LB', 0.0, 27.5), P('S', 'defense', 'LB', -1.0, 30)];
  const st = createPerception(snap(0, trackWorld(defs)), CENTER);
  // Defenders far from the line are all second level at creation (lbs set).
  const tr = cuesFor(st, 'T').track;
  assert.ok(tr.ids.includes('A'));
  assert.ok(!tr.ids.includes('B'));
  assert.ok(!tr.ids.includes('F'));
  assert.deepEqual(tr.ids, ['N', 'A', 'S']);
  assert.ok(TRACK_HALF === 1.5);
  assert.equal(tr.lb, 'N');
  // A line-level defender in the track is not an lb.
  const st2 = createPerception(snap(0, trackWorld([P('D', 'defense', 'DT', 0, 25.5), P('L', 'defense', 'LB', 0.5, 29.5)])), CENTER);
  const tr2 = cuesFor(st2, 'T').track;
  assert.deepEqual(tr2.ids, ['D', 'L']);
  assert.equal(tr2.lb, 'L');
});

const lbWorld = (extra = []) => [...baseLine(), P('MLB', 'defense', 'LB', 0.5, 29.5), ...extra];
// Observer RT (x 2.4): MLB at x 0.5 is outside RT's track; use LG (x -1.2) for an inside-track case.
const lbMove = (vx, vy, extra = [], n = 30) => run(lbWorld(extra), n, (k, t) => moved(lbWorld(extra), 'MLB', vx * t, vy * t));
const lbOf = (st, who) => cuesFor(st, who).lbs.MLB;

test('LB states', () => {
  assert.equal(lbOf(lbMove(0, 0), 'RT'), 'sitting');
  assert.equal(lbOf(lbMove(0, -3), 'RT'), 'filling');
  assert.equal(lbOf(lbMove(-3, 0), 'RT'), 'flowing');   // x 0.5 is outside RT's track
  assert.equal(lbOf(lbMove(-3, 0, [], 20), 'RG'), 'crossing');  // within 1.5 of RG at 1.2
  assert.equal(lbOf(lbMove(0, 2), 'RT'), 'covering');
  const rb = [P('RB', 'offense', 'RB', 1.5, 29.5)];
  const st = run(lbWorld(rb), 30, (k, t) => moved(moved(lbWorld(rb), 'MLB', -3 * t, 0), 'RB', -3 * t, 0));
  assert.equal(lbOf(st, 'RT'), 'covering');
  assert.deepEqual(Object.keys(cuesFor(st, 'RT').lbs), ['MLB']);
  assert.equal(cuesFor(st, 'MLB').lbs, null);
});

test('reaction delay', () => {
  const w = (reaction) => [...baseLine().map((p) => (p.id === 'RT' && reaction != null ? { ...p, reaction } : p)), P('MLB', 'defense', 'LB', 0.5, 29.5)];
  const frames = (n, reaction) => run(w(reaction), n, (k, t) => moved(w(reaction), 'MLB', 0, -3 * Math.max(0, t - 0.5)));
  const a = frames(39, null); // latest t = 0.65
  assert.ok(Math.abs(a.history.at(-1).t - 0.65) < 1e-9);
  assert.equal(cuesFor(a, 'RT').lbs.MLB, 'sitting');
  assert.ok(Math.abs(cuesFor(a, 'RT').seen - 0.45) < 1e-9);
  assert.equal(cuesFor(a, 'RT').delay, REACTION_DELAY);
  const b = frames(51, null); // 0.85
  assert.equal(cuesFor(b, 'RT').lbs.MLB, 'filling');
  const c = frames(39, 0);
  assert.equal(cuesFor(c, 'RT').lbs.MLB, 'filling');
  assert.ok(Math.abs(cuesFor(c, 'RT').seen - 0.65) < 1e-9);
});

const feltWorld = () => [...baseLine(), P('D', 'defense', 'DT', 1.2, 25.6)];

test('felt', () => {
  const two = stateOf(feltWorld(), [{ blocker: 'RG', defender: 'D' }, { blocker: 'RT', defender: 'D' }]);
  assert.equal(cuesFor(two, 'D').felt, 'double');
  const one = (vx, vy) => run(feltWorld(), 30, (k, t) => moved(feltWorld(), 'RG', vx * t, vy * t), [{ blocker: 'RG', defender: 'D' }]);
  assert.equal(cuesFor(one(0, 2), 'D').felt, 'base');
  assert.equal(cuesFor(one(-2, 0), 'D').felt, 'reach');
  assert.equal(cuesFor(one(0, -1), 'D').felt, 'pass');
  const across = (dx) => run(feltWorld(), 30, (k, t) => moved(feltWorld(), 'RG', dx * (k / 30), 0));
  assert.equal(cuesFor(across(1), 'D').felt, 'down');
  assert.equal(cuesFor(across(0), 'D').felt, 'none');
  assert.equal(cuesFor(across(0), 'RG').felt, null);
});

const hatRun = (vy) => run([...baseLine(), P('D', 'defense', 'DT', 0, 25.6)], 30,
  (k, t) => [...baseLine().map((p) => ({ ...p, y: p.y + vy * t })), P('D', 'defense', 'DT', 0, 25.6)]);

test('hat', () => {
  assert.equal(cuesFor(hatRun(1), 'D').hat, 'low');
  assert.equal(cuesFor(hatRun(-1), 'D').hat, 'high');
  assert.equal(cuesFor(hatRun(0), 'D').hat, 'none');
  assert.equal(cuesFor(hatRun(0), 'C').hat, null);
});

test('flow', () => {
  const flow = (lineVx, rbVx) => {
    const w = (t) => [...baseLine().map((p) => ({ ...p, x: p.x + lineVx * t })), P('RB', 'offense', 'RB', 1.6, 19.7 + 0 * t), P('D', 'defense', 'DT', 0, 25.6)]
      .map((p) => (p.id === 'RB' ? { ...p, x: 1.6 + rbVx * t } : p));
    return cuesFor(run(w(0), 30, (k, t) => w(t), [], 'RB'), 'D').flow;
  };
  assert.deepEqual(flow(0, -4), { kind: 'slow', dir: -1 });
  assert.deepEqual(flow(-3.5, -4), { kind: 'fast', dir: -1 });
  assert.deepEqual(flow(-1, 3), { kind: 'split', dir: 1 });
  assert.deepEqual(flow(0, 0), { kind: 'none', dir: 0 });
});

test('key on base', () => {
  const st = createPerception(lineupSnap({ front: 'base' }), CENTER);
  assert.deepEqual(cuesFor(st, 'MLB').key, { id: 'RG' });
  assert.deepEqual(cuesFor(st, 'WLB').key, { id: 'LG' });
  assert.equal(cuesFor(st, 'LDT').key, null);
  assert.equal(cuesFor(st, 'RT').key, null);
  assert.deepEqual(Object.keys(perceiveAll(st)).length, 15);
});

test('observe history window and seenAt', () => {
  const st = run(baseLine(), 180, () => baseLine());
  const first = st.history[0];
  const last = st.history.at(-1);
  assert.ok(last.t - first.t >= HISTORY_S - 1e-9 && last.t - first.t < HISTORY_S + 2 * DT);
  assert.equal(seenAt(st, -5), first);
  assert.equal(seenAt(st, 99), last);
  assert.equal(seenAt(st, last.t - 1 / 120), st.history.at(-2));
  assert.deepEqual(velocityOf(st, 'nobody', last.t), { x: 0, y: 0 });
  assert.deepEqual(velocityOf(st, 'C', first.t - 1), { x: 0, y: 0 });
});

test('purity of the module source', () => {
  const src = readFileSync(new URL('../src/dots/perceive.js', import.meta.url), 'utf8');
  for (const m of ['blocking', 'steering', 'react', 'technique', 'facing', 'carrier', 'defense', 'tackle']) {
    assert.ok(!new RegExp(`import[^;]*from\\s+['"][^'"]*/${m}\\.js['"]`).test(src), `imports ${m}`);
  }
  assert.ok(!/\.(vel|selfVel|react|steer|carry)\b/.test(src));
  assert.ok(!/Math\.random|Date|performance/.test(src));
});
