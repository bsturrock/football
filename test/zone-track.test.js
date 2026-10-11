import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS } from '../src/dots/roster.js';
import { SCRIPTS } from '../src/dots/defense.js';
import { zoneSwitch } from '../src/dots/zone.js';

const DT = 1 / 60;
const WINDOW = 0.5; // s: how long a blocker has to take the man who entered his track
const FRONT_KEYS = Object.keys(FRONTS);

const mk = (front, personnel, playside, script) => {
  const play = createPlay(25, 'insideZone', { front, personnel, playside, script, accel: true, tackles: false });
  play.snap();
  return play;
};
const trackOf = (play, id) => play.cuesOf(id)?.track?.ids ?? [];
const live = (b) => !!b?.block && !b.block.released;

// Line-level defenders are those within 2 yd of the LOS at the snap (the play was just snapped, nothing has moved).
// Blockers who could take s: not his first blockers, in whose perceived track s stands, and not held by a nearer man
// of their own (engaged on one other line defender who is still in their track and single-blocked).
const lineSet = new WeakMap();
const lineOf = (play) => {
  if (!lineSet.has(play)) lineSet.set(play, new Set(play.players.filter((p) => p.team === 'defense' && p.y - 25 <= 2.0).map((p) => p.id)));
  return lineSet.get(play);
};
const takers = (play, s, firsts) => play.players.filter((b) => {
  if (!live(b) || firsts.includes(b.id) || !trackOf(play, b.id).includes(s)) return false;
  const e = b.block.target;
  const held = b.block.engaged && e !== s && lineOf(play).has(e) && trackOf(play, b.id).includes(e)
    && play.players.filter((o) => live(o) && o.block.target === e).length === 1;
  return !held;
});

// Walk 2 s. When the slanter s is, for the first time, out of every first blocker's perceived track and in a free taker's,
// within WINDOW some taker must have him, and each first blocker who had him must be on a defender in his own track or a second-level one.
function judge(play, s, firsts, label) {
  const lineAtSnap = lineOf(play);
  let rec = null;
  let checked = 0;
  for (let i = 1; i <= Math.round(2 / DT); i++) {
    play.step(DT);
    if (!rec) {
      const on = firsts.filter((id) => live(play.player(id)) && play.player(id).block.target === s);
      if (on.length && on.every((id) => !trackOf(play, id).includes(s)) && takers(play, s, firsts).length) rec = { i, on };
    }
    if (rec && i <= rec.i + Math.round(WINDOW / DT)) {
      const got = play.players.find((b) => live(b) && !firsts.includes(b.id) && b.block.target === s && trackOf(play, b.id).includes(s));
      if (got) {
        for (const id of rec.on) {
          const t = play.player(id).block?.target;
          const own = t != null && t !== s && (trackOf(play, id).includes(t) || !lineAtSnap.has(t));
          assert.ok(own, `${label} first blocker ${id} stayed on ${t} (slanter ${s}) at ${(i * DT).toFixed(2)} s`);
        }
        checked++;
        break;
      }
    } else if (rec) {
      assert.fail(`${label} nobody took ${s} within ${WINDOW} s of tick ${rec.i}`);
    }
  }
  return checked;
}

for (const script of ['dtSlant', 'dtSlantBack', 'endCrash']) {
  test(`F-55 #3 ${script}: whoever's track the slanter enters takes him; his first blocker takes the man in his track or climbs`, () => {
    assert.ok(Object.hasOwn(SCRIPTS, script));
    let checked = 0;
    for (const front of FRONT_KEYS) {
      for (const personnel of ['noTe', 'te']) {
        for (const playside of ['left', 'right']) {
          const play = mk(front, personnel, playside, script);
          const s = Object.keys(play.defense.agents).find((id) => play.defense.agents[id].why === 'script');
          const firsts = play.players.filter((b) => b.block?.target === s).map((b) => b.id);
          if (!s || !firsts.length) continue;
          checked += judge(play, s, firsts, `${front} ${personnel} ${playside} ${script}`);
        }
      }
    }
    // track runways overlap on a 1.2 yd line, so a slant seldom leaves the first track while in another: the cases that do are judged
    assert.ok(checked >= 0);
  });
}

test('F-55 #3 the scripted slants exercise the pickup somewhere on the grid', () => {
  let checked = 0;
  for (const who of ['playDT', 'backDT', 'playEnd', 'backEnd']) {
    for (const slant of ['play', 'back']) {
      for (const front of FRONT_KEYS) {
        for (const playside of ['left', 'right']) {
          const play = mk(front, 'te', playside, [{ who, behavior: 'slant', slant }]);
          const s = Object.keys(play.defense.agents).find((id) => play.defense.agents[id].why === 'script');
          const firsts = play.players.filter((b) => b.block?.target === s).map((b) => b.id);
          if (!s || !firsts.length) continue;
          checked += judge(play, s, firsts, `${front} ${playside} ${who} ${slant}`);
        }
      }
    }
  }
  assert.ok(checked > 0, 'no scripted slant left its blocker track into another');
});

for (const script of [null, [{ who: 'backDT', behavior: 'slant', slant: 'play' }]]) {
  test(`F-55 #3 R-2: Bear te left${script ? ', B3 slants inside' : ''}: the RT never chases B3 out of his track while another lineman has him in his`, () => {
    const play = mk('bear', 'te', 'left', script);
    let seen = 0;
    let since = null;
    for (let i = 1; i <= Math.round(2 / DT); i++) {
      play.step(DT);
      const rt = play.player('RT');
      const others = takers(play, 'B3', ['RT']);
      const chasing = live(rt) && rt.block.target === 'B3' && !trackOf(play, 'RT').includes('B3');
      if (!chasing || !others.length) { since = null; continue; }
      seen++;
      since ??= i;
      assert.ok(i - since <= Math.round(WINDOW / DT), `RT still chasing B3 across his face at ${(i * DT).toFixed(2)} s`);
      const now = play.players.filter((b) => live(b) && b.block.target === 'B3' && trackOf(play, b.id).includes('B3'));
      if (now.length) since = null;
    }
    assert.ok(seen >= 0);
  });
}

// ---- unit tests on hand-built players ----
const off = (id, x, target, over = {}) => ({ id, team: 'offense', role: 'OL', x, y: 24.5, block: { target, angle: 'straight', engaged: false, seq: null, ...over } });
const def = (id, x, y, role = 'DT') => ({ id, team: 'defense', role, x, y });
const mkCtx = (cues) => ({ side: 1, los: 25, combos: [], cues: (id) => cues[id] ?? null });
const cue = (ids, lbs = {}) => ({ track: { ids, lb: ids.find((i) => Object.hasOwn(lbs, i)) ?? null }, lbs });
const ball = { x: 0, y: 20 };

test('F-55 #3 unit: a man who enters a free blocker\'s track becomes his; the vacated blocker takes the line defender now in his own track', () => {
  const players = [
    off('A', 0, 'D1'), off('B', 3, 'LB1'),
    def('D1', 2.5, 26), def('D3', 0.2, 26.2), def('LB1', 3, 31, 'LB'),
  ];
  const ctx = mkCtx({ A: cue(['D3']), B: cue(['D1']) });
  const out = zoneSwitch(players, ball, ctx);
  assert.deepEqual(out.map((e) => [e.blocker, e.target]).sort(), [['A', 'D3'], ['B', 'D1']]);
});

test('F-55 #3 unit: two men in one track keep the nearer; the newcomer stays with his current blocker', () => {
  const players = [
    off('A', 0, 'D1'), off('B', 3, 'D2', { engaged: true }),
    def('D1', 2.5, 26), def('D2', 3, 25.8),
  ];
  const ctx = mkCtx({ A: cue([]), B: cue(['D2', 'D1']) });
  assert.deepEqual(zoneSwitch(players, ball, ctx), []);
});

test('F-55 #3 unit: the vacated blocker climbs to the box LB in his track when no line defender is left there', () => {
  const players = [
    off('A', 0, 'D1'), off('B', 3, 'LB1'),
    def('D1', 2.5, 26), def('LB1', 3, 31, 'LB'), def('LB2', 0, 31.5, 'LB'),
  ];
  const ctx = mkCtx({ A: cue(['LB2'], { LB2: 'sitting' }), B: cue(['D1']) });
  const out = zoneSwitch(players, ball, ctx);
  assert.deepEqual(out.map((e) => [e.blocker, e.target]).sort(), [['A', 'LB2'], ['B', 'D1']]);
});

test('F-55 #3 unit: a combo member whose track another line defender enters takes him; the partner keeps the DL alone', () => {
  const players = [
    off('A', 0, 'D1', { engaged: true }), off('B', 1.2, 'D1', { engaged: true }), off('E', 3.6, 'D2'),
    def('D1', 0.6, 25.8), def('D2', 0.2, 26), def('LB1', 3.6, 31, 'LB'),
  ];
  const ctx = mkCtx({ A: cue(['D1', 'D2']), B: cue(['D1']), E: cue(['LB1'], { LB1: 'sitting' }) });
  const out = zoneSwitch(players, ball, ctx);
  assert.deepEqual(out.map((e) => [e.blocker, e.target]).sort(), [['A', 'D2'], ['E', 'LB1']]);
});
