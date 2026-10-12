import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REACTION_DELAY, HISTORY_S, TRACK_HALF, worldSnapshot, createPerception, observe, seenAt, velocityOf,
  techniqueOf, boxCount, cuesFor, perceiveAll, moveOf,
} from '../src/dots/perceive.js';
import { HEAD_UP, LINE_DEPTH } from '../src/dots/front.js';
import { buildLineup, FRONTS, FORMATIONS } from '../src/dots/roster.js';
import { createPlay, FIXED_DT } from '../src/dots/play.js';

const LOS = 25;
const SIDE = -1;
const DT = 1 / 60;
const P = (id, team, role, x, y, extra = {}) => ({ id, team, role, x, y, ...extra });
const snap = (t, players, contacts = [], carrierId = null, holderId = null) => ({ t, los: LOS, side: SIDE, carrierId, holderId, players, contacts });
const lineup = (opts, play = 'insideZone') => buildLineup(LOS, play, opts)
  .map((p) => ({ id: p.id, team: p.team, role: p.role, x: p.x, y: p.y }));
const lineupSnap = (opts, play) => snap(0, lineup(opts, play));
const CENTER = { centerId: 'C' };

function stateOf(players0, contacts = []) {
  return createPerception(snap(0, players0, contacts), CENTER);
}
// Feed frames t = k/60 where fn(k, tSeconds) returns the player list.
function run(players0, frames, fn, contacts = [], carrierId = null, holderId = null) {
  const st = createPerception(snap(0, players0, contacts, carrierId, holderId), CENTER);
  for (let k = 1; k <= frames; k++) observe(st, snap(k * DT, fn(k, k * DT), contacts, carrierId, holderId));
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
  assert.deepEqual(cuesFor(st, 'MLB').key, { id: 'RG', action: 'none', dir: 0 });
  assert.deepEqual(cuesFor(st, 'WLB').key, { id: 'LG', action: 'none', dir: 0 });
  assert.equal(cuesFor(st, 'LDT').key, null);
  assert.equal(cuesFor(st, 'RT').key, null);
  assert.deepEqual(Object.keys(perceiveAll(st)).length, 15);
});

// Key guard of MLB (x 0.5) is RG (x 1.2): the guard nearer his creation x.
const keyWorld = () => [...baseLine(), P('MLB', 'defense', 'LB', 0.5, 29.5)];
const keyMove = (vx, vy, contacts = []) => run(keyWorld(), 30, (k, t) => moved(keyWorld(), 'RG', vx * t, vy * t), contacts);
const keyOf = (st) => cuesFor(st, 'MLB').key;

test('key action', () => {
  assert.deepEqual(keyOf(keyMove(0, 0, [{ blocker: 'RG', defender: 'MLB' }])), { id: 'RG', action: 'run', dir: 0 });
  assert.deepEqual(keyOf(keyMove(0, -1)), { id: 'RG', action: 'pass', dir: 0 });
  assert.deepEqual(keyOf(keyMove(3, 0)), { id: 'RG', action: 'pull', dir: 1 });
  assert.deepEqual(keyOf(keyMove(-3, 0)), { id: 'RG', action: 'pull', dir: -1 });
  assert.deepEqual(keyOf(keyMove(0, 1)), { id: 'RG', action: 'run', dir: 0 });
  assert.deepEqual(keyOf(keyMove(0, 0)), { id: 'RG', action: 'none', dir: 0 });
});

// Climber world: RT (x 2.4, y 24.25) is the line man; the LB sits 3.2 yd away, off the line.
const climbWorld = (def = P('MLB', 'defense', 'LB', 1.2, 27.25)) => [...baseLine(), def];
const climbMove = (world, vx, vy, contacts = []) => run(world, 30, (k, t) => moved(world, 'RT', vx * t, vy * t), contacts);

test('climber', () => {
  assert.deepEqual(cuesFor(climbMove(climbWorld(), 0, 3), 'MLB').climber, { id: 'RT', side: 1 });
  assert.equal(cuesFor(climbMove(climbWorld(), 0, 3, [{ blocker: 'RT', defender: 'MLB' }]), 'MLB').climber, null);
  assert.equal(cuesFor(climbMove(climbWorld(), 0, -3), 'MLB').climber, null);
  const dl = [...baseLine(), P('DL', 'defense', 'DT', 1.2, 26.5)];
  assert.equal(cuesFor(climbMove(dl, 0, 3), 'DL').climber, null);
  assert.equal(cuesFor(climbMove(climbWorld(), 0, 3), 'RT').climber, null);
});

// Ball world: QB (carrier or holder) at x 0, MLB off the line.
const ballWorld = (qbY = 23) => [...baseLine(), P('QB', 'offense', 'QB', 0, qbY), P('MLB', 'defense', 'LB', 0.5, 29.5)];
const ballOf = (st, who = 'MLB') => cuesFor(st, who).ball;

test('ball', () => {
  const still = run(ballWorld(), 30, () => ballWorld(), [], null, 'QB');
  assert.deepEqual(ballOf(still), { x: 0, y: 23, vx: 0, vy: 0, carried: false, past: false, committed: false });
  const drive = run(ballWorld(), 30, (k, t) => moved(ballWorld(), 'QB', t, 3 * t), [], 'QB', 'QB');
  assert.equal(ballOf(drive).carried, true);
  assert.equal(ballOf(drive).committed, true);
  const lateral = run(ballWorld(), 30, (k, t) => moved(ballWorld(), 'QB', 4 * t, t), [], 'QB', 'QB');
  assert.equal(ballOf(lateral).carried, true);
  assert.equal(ballOf(lateral).committed, false);
  const past = run(ballWorld(26), 30, () => ballWorld(26), [], 'QB', 'QB');
  assert.equal(ballOf(past).past, true);
  assert.equal(ballOf(past).committed, true);
  assert.equal(cuesFor(past, 'QB').ball, null);
  assert.equal(cuesFor(past, 'RT').ball, null);
});

test('ball cue waits the reaction delay', () => {
  const w = (t) => moved(ballWorld(), 'QB', 0, 3 * Math.max(0, t - 0.5));
  const before = run(ballWorld(), 36, (k, t) => w(t), [], 'QB', 'QB'); // latest 0.6, seen 0.4
  assert.equal(ballOf(before).committed, false);
  const after = run(ballWorld(), 48, (k, t) => w(t), [], 'QB', 'QB'); // latest 0.8, seen 0.6
  assert.equal(ballOf(after).committed, true);
});

test('ball carried after the handoff, seen by the MLB', () => {
  const play = createPlay(25, 'insideZone');
  play.snap();
  for (let k = 0; k < 600 && !play.run?.carried; k++) play.step(FIXED_DT);
  assert.ok(play.run.carried);
  assert.equal(play.cuesOf('MLB').ball.carried, false); // the handoff is seen after the reaction delay
  for (let k = 0; k < 30; k++) play.step(FIXED_DT);
  assert.equal(play.cuesOf('MLB').ball.carried, true);
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

test('technique on a line of 7 one side', () => {
  const line = [
    P('C', 'offense', 'OL', 0, 24.72), P('RG', 'offense', 'OL', 1.2, 24.4), P('RT', 'offense', 'OL', 2.4, 24.4),
    P('TE', 'offense', 'TE', 3.6, 24.4), P('TE2', 'offense', 'TE', 4.8, 24.4),
    P('LG', 'offense', 'OL', -1.2, 24.4), P('LT', 'offense', 'OL', -2.4, 24.25),
  ];
  const s = snap(0, [...line, P('DE', 'defense', 'DE', 4.8, LOS + 1)]);
  let t;
  assert.doesNotThrow(() => { t = techniqueOf(s, 'DE', CENTER); });
  assert.equal(t.label, '6');
  assert.equal(t.blocker, 'TE2');
});

test('perceiveAll survives a whole run on every front and formation', () => {
  const LABEL_SET = ['0', '1', '2', '2i', '3', '4', '4i', '5', '6', '7', '9'];
  const runAll = (play) => {
    play.snap();
    const st = createPerception(worldSnapshot(play.players, { t: 0, los: 25, side: 1, carrierId: null }), CENTER);
    for (let tick = 1; tick <= 240 && play.result === null; tick++) {
      play.step(FIXED_DT);
      observe(st, worldSnapshot(play.players, { t: tick * FIXED_DT, los: 25, side: 1, carrierId: null }));
      const cues = perceiveAll(st);
      for (const [id, c] of Object.entries(cues)) {
        const label = c.tech?.label;
        if (label !== undefined) assert.ok(LABEL_SET.includes(label), `${id} label ${label} at tick ${tick}`);
      }
    }
  };
  for (const front of Object.keys(FRONTS)) runAll(createPlay(25, 'insideZone', { front }));
  for (const formation of Object.keys(FORMATIONS)) runAll(createPlay(25, 'insideZone', { formation }));
});

// Run cue: the carrier is RB; SIDE -1 means playside is -x. Playside line defenders by snap x.
const runSnap = (front) => createPerception(snap(0, lineup({ front }), [], 'RB'), CENTER);
const playsideDl = (st) => st.dlIds
  .map((id) => ({ id, u: SIDE * (st.snap[id].x - st.snap.C.x) }))
  .filter((d) => d.u > HEAD_UP)
  .sort((a, b) => a.u - b.u || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

test('run cue: key is the first DL playside of the center', () => {
  for (const front of ['base', 'over43']) {
    const st = runSnap(front);
    const ps = playsideDl(st);
    const r = cuesFor(st, 'RB').run;
    assert.equal(r.key, ps[0].id, `${front} key`);
    assert.equal(r.end, ps.at(-1).id, `${front} end`);
    assert.equal(cuesFor(st, 'QB').run, null);
  }
  const base = runSnap('base');
  assert.equal(cuesFor(base, 'RB').run.key, 'RDT');
  assert.equal(cuesFor(base, 'RB').run.end, 'RDE');
  const over = runSnap('over43');
  assert.equal(cuesFor(over, 'RB').run.key, 'PT');
  assert.equal(cuesFor(over, 'RB').run.end, 'PE');
});

test('run cue: move classes', () => {
  const w = lineup({ front: 'base' });
  const mv = (dx, dy) => cuesFor(run(w, 30, () => moved(w, 'RDT', dx, dy), [], 'RB'), 'RB').run.dl.RDT.move;
  assert.equal(mv(0, -0.6), 'upfield');
  assert.equal(mv(0, 0.6), 'driven');
  assert.equal(mv(SIDE * 0.5, 0), 'widen');
  assert.equal(mv(-SIDE * 0.5, 0), 'squeeze');
  assert.equal(mv(0.1, 0.1), 'held');
  assert.equal(moveOf(createPerception(snap(0, w), CENTER), 'RDT', { x: w.find((p) => p.id === 'RDT').x, y: 24 }), 'upfield');
});

test('run cue: felt is carried and dl/lbs sides', () => {
  const w = lineup({ front: 'base' });
  const contacts = [{ blocker: 'RG', defender: 'RDT' }, { blocker: 'C', defender: 'RDT' }];
  const st = run(w, 30, () => w, contacts, 'RB');
  const r = cuesFor(st, 'RB').run;
  assert.equal(r.dl.RDT.felt, 'double');
  assert.equal(r.dl.RDT.side, 'play');
  assert.equal(r.dl.LDE.side, 'back');
  assert.equal(r.dl.RDT.move, 'held');
  const flowing = run(w, 30, (k, t) => moved(w, 'MLB', SIDE * 2 * t, 0), [], 'RB');
  const lb = cuesFor(flowing, 'RB').run.lbs.MLB;
  assert.equal(lb.dir, 1);
  assert.equal(lb.state, 'flowing');
  const filling = run(w, 30, (k, t) => moved(w, 'MLB', 0, -2 * t), [], 'RB');
  const fl = cuesFor(filling, 'RB').run.lbs.MLB;
  assert.equal(fl.state, 'filling');
  assert.equal(fl.dir, 0);
});

test('run cue: play passes the carrier cues', () => {
  const play = createPlay(25, 'insideZone', { front: 'base' });
  play.snap();
  const dlWant = play.players
    .filter((p) => p.team === 'defense' && p.y - 25 > 0 && p.y - 25 <= LINE_DEPTH)
    .map((p) => p.id);
  assert.ok(dlWant.length >= 4);
  for (let k = 0; k < 40; k++) play.step(FIXED_DT);
  const c = play.cuesOf(play.run.carrier).run;
  assert.equal(typeof c, 'object');
  assert.ok(c !== null);
  for (const id of dlWant) assert.ok(id in c.dl, `dl entry for ${id}`);
});
