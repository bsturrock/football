import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startDefense, stepDefense, validateBehavior, recogTime, readTimeOf, RECOG_FAST, RECOG_SLOW, LB_READ_TIME, KEY_MOVE, BEHAVIORS,
} from '../src/dots/defense.js';
import { createPlay } from '../src/dots/play.js';
import { readFront } from '../src/dots/front.js';
import { numberPlay } from '../src/dots/numbering.js';
import { buildLineup } from '../src/dots/roster.js';

const LOS = 25;
const by = (pl, id) => pl.find((p) => p.id === id);

// A base-front lineup at LOS 25 with the given recognition ratings set before startDefense.
const rated = (recogs = {}, opts = {}) => {
  const players = buildLineup(LOS, 'insideZone').map((p) => ({ ...p }));
  for (const [id, r] of Object.entries(recogs)) by(players, id).recog = r;
  const numbers = numberPlay(players, { los: LOS, centerId: 'C', playside: 'left' });
  const front = readFront(players, numbers, LOS);
  const defense = startDefense(players, front, { los: LOS, carrierId: 'RB', ...opts });
  const run = { carrier: 'RB', aim: { x: -2, y: LOS }, carried: false, locked: false };
  return { players, front, defense, run, ball: { x: 0, y: LOS - 3 } };
};
const step = (s, dt = 0.05) => stepDefense(s.players, s.defense, { run: s.run, ballPos: s.ball, cues: s.cues }, dt);

// LB cue stubs: every defender with an agent sees `cue` merged over a quiet default.
const lbCue = (o = {}) => ({
  key: { id: 'LG', action: 'none', dir: 0 }, hat: 'none', flow: { kind: 'none', dir: 0 },
  ball: { x: 0, y: LOS, vx: 0, vy: 0, carried: false, past: false, committed: false }, ...o,
});
const stubLB = (s, o) => { s.cues = (id) => (s.defense.agents[id] ? lbCue(o) : null); return s; };
const RUN = { key: { id: 'LG', action: 'run', dir: 0 } };

test('T-128 (a): recogTime maps 1 to RECOG_SLOW and 99 to RECOG_FAST, clamps, and falls over 1..99', () => {
  assert.ok(Math.abs(recogTime(1) - RECOG_SLOW) < 1e-9);
  assert.ok(Math.abs(recogTime(99) - RECOG_FAST) < 1e-9);
  assert.equal(recogTime(0), recogTime(1));
  assert.equal(recogTime(150), recogTime(99));
  for (let r = 1; r < 99; r++) assert.ok(recogTime(r + 1) < recogTime(r), `r ${r}`);
});

test('T-128 (b): startDefense reads a rated defender\'s recognition time; unrated keep def.read; an unrated contain edge keeps his old value', () => {
  const s = rated({ MLB: 99, WLB: 1 });
  assert.ok(Math.abs(s.defense.agents.MLB.read - recogTime(99)) < 1e-9);
  assert.ok(Math.abs(s.defense.agents.WLB.read - recogTime(1)) < 1e-9);
  assert.equal(s.defense.agents.SLB.read, by(s.players, 'SLB').def.read);
  const edge = s.front.edge;
  assert.equal(s.defense.agents[edge].read, by(s.players, edge).def?.read ?? LB_READ_TIME);
});

// Steps in 0.01 s: the defender holds `state` before his read time and leaves it on the first step at or after it.
const leavesAtRead = (s, id, from, to, limit = 400) => {
  const rt = s.defense.agents[id].read;
  for (let i = 0; i < limit; i++) {
    step(s, 0.01);
    const t = s.defense.t;
    const st = s.defense.agents[id].state;
    if (t < rt - 1e-9) {
      assert.equal(st, from, `${id} still reading at t=${t.toFixed(2)}`);
    } else {
      assert.equal(st, to, `${id} at t=${t.toFixed(2)} >= ${rt.toFixed(2)}`);
      return;
    }
  }
  assert.fail(`${id} never reached his read time`);
};

test('T-128 (c): a rated LB keeps reading until his recognition time, then reads the run on the first step at or after it', () => {
  for (const r of [1, 99]) {
    const s = rated({ MLB: r });
    stubLB(s, RUN);
    leavesAtRead(s, 'MLB', 'read', 'fit');
  }
});

test('T-128 (d): a rated contain edge keeps reading until his recognition time, then squeezes on the first step at or after it', () => {
  for (const r of [1, 99]) {
    const edge = rated().front.edge;
    const s = rated({ [edge]: r });
    by(s.players, 'LG').y += KEY_MOVE;
    leavesAtRead(s, edge, 'read', 'squeeze');
  }
});

// The safety run read: a rated FS leaves cover on a low hat once his read time is in.
const safetyPlay = (recog) => {
  const play = createPlay(LOS, 'insideZone', { formation: '11', tackles: false, recog });
  play.snap();
  return play;
};
const safetyCue = (hat) => (id) => lbCue({ hat, ball: { x: 0, y: LOS - 3, vx: 0, vy: 0, carried: false, past: false, committed: false } });
const stepSafety = (play, cues, dt = 0.01) => stepDefense(play.players, play.defense, { run: play.run, ballPos: { x: 0, y: LOS - 3 }, cues }, dt);

test('T-128 (e): a rated safety stays in cover until his recognition time, then pursues with why runRead on a low hat', () => {
  const play = safetyPlay(80);
  const fs = play.defense.agents.FS;
  const rt = recogTime(80);
  const cues = safetyCue('low');
  for (let i = 0; i < 400; i++) {
    stepSafety(play, cues);
    const t = play.defense.t;
    if (t < rt - 1e-9) {
      assert.equal(fs.state, 'cover', `FS still in cover at t=${t.toFixed(2)}`);
    } else {
      assert.equal(fs.state, 'pursue');
      assert.equal(fs.why, 'runRead');
      return;
    }
  }
  assert.fail('FS never reached his read time');
});

test('T-128 (e): an unrated safety stays in cover on a low hat for 2 s', () => {
  const play = safetyPlay(null);
  const cues = safetyCue('low');
  for (let i = 0; i < 200; i++) stepSafety(play, cues);
  assert.equal(play.defense.agents.FS.state, 'cover');
});

test('T-128 (e): a rated safety with no low hat stays in cover for 2 s', () => {
  const play = safetyPlay(80);
  const cues = safetyCue('none');
  for (let i = 0; i < 200; i++) stepSafety(play, cues);
  assert.equal(play.defense.agents.FS.state, 'cover');
});

test('T-128 (f): validateBehavior throws on a bad read and accepts the support behaviour', () => {
  assert.throws(() => validateBehavior('bad', { bad: { ...BEHAVIORS.support, read: -1 } }), /bad read "-1"/);
  assert.throws(() => validateBehavior('bad', { bad: { ...BEHAVIORS.support, read: 'x' } }), /bad read "x"/);
  assert.equal(validateBehavior('support'), BEHAVIORS.support);
});

test('T-128 (g): createPlay throws on a bad recog', () => {
  for (const r of [0, 100, 2.5, 'a']) {
    assert.throws(() => createPlay(LOS, 'insideZone', { recog: r }), /createPlay: bad recog/, String(r));
  }
});

test('T-128 (g): setRecog accepts 1..99 and null, refuses anything else and keeps the old value', () => {
  const play = createPlay(LOS, 'insideZone');
  assert.equal(play.setRecog(50), 50);
  assert.equal(play.recog, 50);
  assert.equal(play.setRecog(0), false);
  assert.equal(play.recog, 50);
  assert.equal(play.setRecog(null), null);
  assert.equal(play.recog, null);
});

test('T-128 (g): a recog set before the snap rates every defender and sets each agent read; a reset clears it', () => {
  const play = createPlay(LOS, 'insideZone');
  play.setRecog(40);
  play.snap();
  const defense = play.players.filter((p) => p.team === 'defense');
  assert.ok(defense.length > 0);
  for (const p of defense) assert.equal(p.recog, 40, p.id);
  for (const [id, a] of Object.entries(play.defense.agents)) {
    assert.ok(Math.abs(a.read - recogTime(40)) < 1e-9, id);
  }
  play.setRecog(null);
  play.reset();
  play.snap();
  for (const p of play.players) assert.equal(p.recog, undefined, p.id);
  for (const [id, a] of Object.entries(play.defense.agents)) {
    const p = play.players.find((q) => q.id === id);
    assert.equal(a.read, readTimeOf(p, a.behavior), id);
    assert.equal(a.read, p.def?.read ?? BEHAVIORS[a.behavior].read ?? LB_READ_TIME, id);
  }
});
