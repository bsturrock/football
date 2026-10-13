import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { DB_ROLES, FRONTS } from '../src/dots/roster.js';
import { readFront } from '../src/dots/front.js';
import { BODY_RADIUS } from '../src/dots/blocking.js';
import { BEHAVIORS, LATE_FILL_AT, PEDAL_DEPTH, PURSUE_REACH, SCRIPTS, WHO, shiftGap, validateScript } from '../src/dots/defense.js';

const LOS = 25;
const FRONT_KEYS = Object.keys(FRONTS);

const engaged = (play, id) => play.players.some((p) => p.block?.target === id && p.block.engaged);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function snapped(front, script, extra = {}) {
  const play = createPlay(LOS, 'insideZone', { front, script, ...extra });
  assert.ok(play.snap());
  return play;
}

// Runs the play and calls fn(play, tick) after each tick, up to maxT seconds.
function run(play, maxT, fn) {
  for (let t = 0; t < Math.round(maxT / FIXED_DT) && play.ball.phase !== 'dead'; t++) {
    play.step(FIXED_DT);
    fn(play, t + 1);
  }
}

const carrierY = (play) => play.player(play.run.carrier).y;
const idsFor = (key, front = 'base') => {
  const play = createPlay(LOS, 'insideZone', { front });
  play.snap();
  const fr = readFront(play.players, play.numbers, LOS);
  return fr.defenders.filter((f) => WHO[key](play.player(f.id), f, fr, play.players)).map((f) => f.id);
};

test('SCRIPTS keys and validateScript', () => {
  assert.deepEqual(Object.keys(SCRIPTS), ['lbSits', 'lbFills', 'lbFillsLate', 'lbBlitz', 'dtSlant', 'dtSlantBack', 'endCrash']);
  for (const k of Object.keys(SCRIPTS)) assert.doesNotThrow(() => validateScript(k));
  assert.doesNotThrow(() => validateScript(null));
  assert.doesNotThrow(() => validateScript([{ who: 'playLB', behavior: 'sit', at: 0.2 }]));
  assert.throws(() => validateScript('nope'));
  assert.throws(() => validateScript([{ who: 'nobody', behavior: 'sit' }]));
  assert.throws(() => validateScript([{ who: 'playLB', behavior: 'nope' }]));
  assert.throws(() => validateScript([{ who: 'playDT', behavior: 'slant', slant: 'up' }]));
  assert.throws(() => validateScript([{ who: 'playLB', behavior: 'sit', at: -1 }]));
  assert.throws(() => validateScript([{ who: 'playLB', behavior: 'sit', at: NaN }]));
  assert.throws(() => validateScript([{ who: 'playLB', behavior: 'sit', at: Infinity }]));
});

test('shiftGap', () => {
  const cases = [
    [{ side: 'play', name: 'A' }, 'play', { side: 'play', name: 'B' }],
    [{ side: 'play', name: 'A' }, 'back', { side: 'back', name: 'A' }],
    [{ side: 'back', name: 'A' }, 'play', { side: 'play', name: 'A' }],
    [{ side: 'back', name: 'B' }, 'play', { side: 'back', name: 'A' }],
    [{ side: 'back', name: 'A' }, 'back', { side: 'back', name: 'B' }],
    [{ side: 'play', name: 'B' }, 'back', { side: 'play', name: 'A' }],
    [{ side: 'play', name: 'F' }, 'play', { side: 'play', name: 'F' }],
    [{ side: 'back', name: 'F' }, 'back', { side: 'back', name: 'F' }],
  ];
  for (const [fit, dir, want] of cases) assert.deepEqual(shiftGap(fit, dir), want);
});

test('selectors pick the expected ids on the default look', () => {
  const want = {
    base: { playLB: 'WLB', backLB: 'MLB', playDT: 'RDT', backDT: 'LDT', playEnd: 'RDE', backEnd: 'LDE' },
    over43: { playLB: 'MIK', backLB: 'WIL', playDT: 'PT', backDT: 'BT', playEnd: 'PE' },
    bear: { playLB: 'L1', backLB: 'L2', playDT: 'N', backDT: 'B3', playEnd: 'PE' },
  };
  for (const [front, sel] of Object.entries(want)) {
    for (const [key, id] of Object.entries(sel)) assert.deepEqual(idsFor(key, front), [id], `${front} ${key}`);
  }
});

test('every selector matches exactly one defender on every front', () => {
  for (const front of FRONT_KEYS) {
    for (const key of ['playLB', 'backLB', 'playDT', 'backDT', 'playEnd', 'backEnd']) {
      assert.equal(idsFor(key, front).length, 1, `${front} ${key}`);
    }
  }
});

test('selectors are false without front or players', () => {
  assert.equal(WHO.playLB({ id: 'x' }, null, null, null), false);
  assert.equal(WHO.backEnd({ id: 'x' }, null, null, null), false);
});

test('lbSits: neither LB commits or moves before the carrier crosses', () => {
  for (const front of FRONT_KEYS) {
    const play = snapped(front, 'lbSits');
    const ids = [...idsFor('playLB', front), ...idsFor('backLB', front)];
    const spot = Object.fromEntries(ids.map((id) => [id, { x: play.player(id).x, y: play.player(id).y }]));
    let crossed = false;
    const free = new Set(ids);
    run(play, 3, (pl) => {
      if (carrierY(pl) > LOS) crossed = true;
      for (const id of ids) {
        if (engaged(pl, id)) free.delete(id);
        if (crossed) continue;
        assert.ok(!pl.defense.committed[id], `${front} ${id} committed`);
        if (free.has(id)) assert.ok(dist(pl.player(id), spot[id]) <= BODY_RADIUS + 1e-9, `${front} ${id} moved`);
      }
    });
  }
});

test('lbFills: committed on the first tick and moves downhill', () => {
  for (const front of FRONT_KEYS) {
    const play = snapped(front, 'lbFills');
    const [id] = idsFor('playLB', front);
    const y0 = play.player(id).y;
    let dropped = false;
    run(play, 0.5, (pl, t) => {
      if (t === 1) {
        assert.ok(pl.defense.committed[id], `${front} not committed`);
        assert.equal(pl.defense.agents[id].why, 'scriptAt');
      }
      if (y0 - pl.player(id).y >= 0.5 || engaged(pl, id)) dropped = true;
    });
    assert.ok(dropped, front);
  }
});

test('lbFillsLate: sits until LATE_FILL_AT then commits', () => {
  for (const front of FRONT_KEYS) {
    const play = snapped(front, 'lbFillsLate');
    const [id] = idsFor('playLB', front);
    const spot = { x: play.player(id).x, y: play.player(id).y };
    let free = true;
    run(play, LATE_FILL_AT + 2 * FIXED_DT, (pl, t) => {
      const now = t * FIXED_DT;
      if (engaged(pl, id)) free = false;
      if (now < LATE_FILL_AT - 1e-9) {
        assert.ok(!pl.defense.committed[id], `${front} early commit`);
        if (free) assert.ok(dist(pl.player(id), spot) <= BODY_RADIUS + 1e-9, `${front} moved early`);
      }
    });
    assert.ok(play.defense.committed[id], `${front} not committed by LATE_FILL_AT + 2 ticks`);
  }
});

test('lbBlitz: blitz state at tick one, closes on the los', () => {
  for (const front of FRONT_KEYS) {
    const play = snapped(front, 'lbBlitz');
    const [id] = idsFor('playLB', front);
    const y0 = play.player(id).y - LOS;
    let ok = false;
    run(play, 0.6, (pl, t) => {
      if (t === 1) assert.equal(pl.defense.agents[id].state, 'blitz');
      if (y0 - (pl.player(id).y - LOS) >= 1.0 || engaged(pl, id)) ok = true;
    });
    assert.ok(ok, front);
  }
});

for (const [script, dir] of [['dtSlant', 'play'], ['dtSlantBack', 'back']]) {
  test(`${script}: fit shifted ${dir}, early lateral move that way`, () => {
    for (const front of FRONT_KEYS) {
      const base = snapped(front, null);
      const [id] = idsFor('playDT', front);
      const readFit = base.defense.agents[id].fit;
      const play = snapped(front, script);
      const agent = play.defense.agents[id];
      assert.deepEqual(agent.fit, shiftGap(readFit, dir), front);
      const x0 = play.player(id).x;
      const sign = dir === 'play' ? play.defense.side : -play.defense.side;
      let n = 0;
      run(play, 0.5, (pl, t) => {
        if (t === 1) assert.equal(pl.defense.agents[id].state, 'slant');
        if (n > 0 && engaged(pl, id)) return;
        if (t > 1 && engaged(pl, id)) return;
        n = t;
        const dx = pl.player(id).x - x0;
        if (t >= 6 && Math.abs(dx) > 1e-6) assert.ok(Math.sign(dx) === sign, `${front} ${script} dx ${dx}`);
      });
      assert.ok(n >= 1);
    }
  });
}

test('endCrash: backside end slants inside', () => {
  for (const front of FRONT_KEYS) {
    const base = snapped(front, null);
    const [id] = idsFor('backEnd', front);
    const readFit = base.defense.agents[id].fit;
    const play = snapped(front, 'endCrash');
    const agent = play.defense.agents[id];
    assert.equal(agent.behavior, 'slant');
    assert.deepEqual(agent.fit, shiftGap(readFit, 'play'));
    const x0 = play.player(id).x;
    const toward = -Math.sign(play.player(id).x - play.defense.centerX); // toward the center
    let n = 0;
    run(play, 0.5, (pl, t) => {
      if (engaged(pl, id)) return;
      n = t;
      const dx = pl.player(id).x - x0;
      if (t >= 6 && Math.abs(dx) > 1e-6) assert.ok(Math.sign(dx) === toward, `${front} dx ${dx}`);
    });
    assert.ok(n >= 1);
  }
});

test('no script is identical to the option omitted; setScript after the snap is false', () => {
  for (const front of FRONT_KEYS) {
    const a = createPlay(LOS, 'insideZone', { front, script: null });
    const b = createPlay(LOS, 'insideZone', { front });
    a.snap(); b.snap();
    for (let t = 0; t < 120; t++) {
      a.step(FIXED_DT); b.step(FIXED_DT);
      a.players.forEach((p, i) => {
        assert.equal(p.x, b.players[i].x);
        assert.equal(p.y, b.players[i].y);
      });
    }
    assert.equal(a.setScript('lbSits'), false);
  }
  const p = createPlay(LOS, 'insideZone');
  assert.equal(p.setScript('bogus'), false);
  assert.equal(p.setScript('lbSits'), 'lbSits');
  assert.equal(p.setScript(null), null);
});

test('corners pedal and wait; safeties pedal until the commit; WRs and the FB are not moved', () => {
  for (const formation of ['11', '21']) {
    const play = createPlay(LOS, 'insideZone', { formation });
    assert.ok(play.snap());
    const dbs = play.players.filter((p) => p.team === 'defense' && DB_ROLES.includes(p.role));
    assert.ok(dbs.length > 0);
    const spot = Object.fromEntries(play.players.map((p) => [p.id, { x: p.x, y: p.y }]));
    for (const d of dbs) assert.equal(play.defense.agents[d.id]?.behavior, d.role === 'S' ? 'support' : 'cover', `${formation} ${d.id}`);
    const still = play.players.filter((p) => p.role === 'WR' || p.role === 'FB');
    let crossedAt = null;
    const free = new Set(dbs.map((d) => d.id));
    const committedLast = new Map();
    run(play, 2, (pl, t) => {
      const ball = pl.ballPosition();
      const past = !!pl.run.carried && ball.y > LOS;
      if (past && crossedAt == null) crossedAt = t;
      for (const d of dbs) {
        const close = !!pl.run.carried && dist(ball, pl.player(d.id)) <= PURSUE_REACH;
        const state = pl.defense.agents[d.id].state;
        if (engaged(pl, d.id)) free.delete(d.id);
        // A safety on support holds his pedal spot only while he is still in cover.
        const holding = d.role !== 'S' || state === 'cover';
        if (!past && !close && free.has(d.id) && holding) {
          const p = pl.player(d.id);
          const s = spot[d.id];
          assert.ok(Math.abs(p.x - s.x) <= BODY_RADIUS + 1e-9, `${formation} ${d.id} moved`);
          assert.ok(p.y >= s.y - BODY_RADIUS - 1e-9 && p.y <= s.y + PEDAL_DEPTH + BODY_RADIUS + 1e-9, `${formation} ${d.id} moved`);
        }
        if (d.role === 'S' && committedLast.get(d.id)) assert.equal(state, 'pursue', `${formation} ${d.id} did not come down on the commit`);
        committedLast.set(d.id, d.role === 'S' && pl.cuesOf(d.id)?.ball?.committed === true);
        if (crossedAt != null && t >= crossedAt + 1) assert.equal(state, 'pursue');
      }
      for (const w of still) assert.ok(dist(pl.player(w.id), spot[w.id]) <= BODY_RADIUS + 1e-9, `${formation} ${w.id} moved`);
    });
  }
});

test('11 personnel: FS and SS support the run, CBX, CBZ and NB cover', () => {
  assert.equal(BEHAVIORS.support.start, 'cover');
  const play = createPlay(LOS, 'insideZone', { formation: '11', tackles: false });
  assert.ok(play.snap());
  const behaviour = (id) => play.defense.agents[id]?.behavior;
  assert.equal(behaviour('FS'), 'support');
  assert.equal(behaviour('SS'), 'support');
  for (const id of ['CBX', 'CBZ', 'NB']) assert.equal(behaviour(id), 'cover', id);
});
