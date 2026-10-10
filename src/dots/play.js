// Dots play state: lineup positions and ball possession. Pure: no THREE, no DOM.
// Ball phases: presnap -> snapping -> held -> carried -> dead (carried and dead only on plays with a run).
// Time advances only through step(dt); there are no timers or clocks here.

import { FRONTS, PLAYS, buildLineup } from './roster.js';
import { numberPlay } from './numbering.js';
import { startRun, stepCarrier } from './carrier.js';
import { zonePlan, zoneSwitch } from './zone.js';
import { readFront } from './front.js';
import { ACCEL_TAU } from './steering.js';
import { playEnd } from './tackle.js';
import { initFacing, stepFacing } from './facing.js';
import { startDefense, stepDefense } from './defense.js';
import {
  BODY_RADIUS,
  assignBlocks,
  clearBlock,
  doubleTeamPeel,
  engagedOn,
  isBlocker,
  setBlock,
  stepBlocking,
} from './blocking.js';

export const SNAP_DURATION = 0.25; // seconds; quick shotgun snap, ball C to QB at roughly 18 yd/s
export const FIXED_DT = 1 / 60; // sim seconds per tick
export const MAX_SUBSTEP = FIXED_DT; // max sim seconds per stepBlocking call
export const MAX_TICKS_PER_STEP = 30; // runaway-frame guard: 0.5 s of sim per step call
export const SIM_SPEED = 0.35; // dots page default time scale
export const SIM_SPEED_MIN = 0.1;
export const SIM_SPEED_MAX = 2;
export const DL_SHIFT_STEP = BODY_RADIUS; // yards per pre-snap D-line shift step
export const DL_SHIFT_MAX = 4; // steps allowed each way
export const LB_SHIFT_STEP = BODY_RADIUS; // yards per pre-snap linebacker shift step
export const LB_SHIFT_MAX = 6; // steps allowed each way

// A scheme's plan returns {side, blocks, techs, combos, free, front}.
const SCHEMES = Object.freeze({ zone: Object.freeze({ plan: zonePlan, rule: zoneSwitch }) });

export function createPlay(los = 25, playKey = 'base', { timeScale = 1, front = 'base', accel = true, tackles = true, fightBlocks = true } = {}) {
  const scheme = SCHEMES[PLAYS[playKey].scheme] || null;
  const play = {
    los,
    playKey,
    players: [],
    ball: {},
    retargetRule: scheme ? scheme.rule : doubleTeamPeel,
    timeScale,
    front,
    accel,
    tackles,
    // off = defenders never win leverage or shed; blocks still release 'past' and 'lost'.
    fightBlocks,
    dlShift: 0,
    lbShift: 0,
    numbers: {},
    combos: [],
    run: null,
    defense: null,
    ticks: 0,
    result: null,
    alpha: 0,
    prev: {},
  };
  let ctx = { seq: 0 };
  let acc = 0;
  const snapshotPrev = () => {
    play.prev = {};
    for (const p of play.players) play.prev[p.id] = { x: p.x, y: p.y, facing: p.facing };
  };

  play.player = (id) => play.players.find((p) => p.id === id);

  // Pre-snap D-line shift in steps. Only changes while the ball is presnap.
  play.shiftDL = (dir) => {
    if (play.ball.phase !== 'presnap') return false;
    if (dir !== 1 && dir !== -1) return play.dlShift;
    play.dlShift = Math.min(DL_SHIFT_MAX, Math.max(-DL_SHIFT_MAX, play.dlShift + dir));
    play.reset();
    return play.dlShift;
  };

  // Pre-snap linebacker shift in steps. Only changes while the ball is presnap.
  play.shiftLB = (dir) => {
    if (play.ball.phase !== 'presnap') return false;
    if (dir !== 1 && dir !== -1) return play.lbShift;
    play.lbShift = Math.min(LB_SHIFT_MAX, Math.max(-LB_SHIFT_MAX, play.lbShift + dir));
    play.reset();
    return play.lbShift;
  };

  // Pre-snap defensive front, a key of FRONTS. Only changes while the ball is presnap.
  play.setFront = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (!Object.hasOwn(FRONTS, key)) return false;
    play.front = key;
    play.reset();
    return key;
  };

  // Scales how fast play.step advances; the only place time scale applies.
  play.setTimeScale = (s) => {
    if (!Number.isFinite(s)) return play.timeScale;
    play.timeScale = Math.min(SIM_SPEED_MAX, Math.max(SIM_SPEED_MIN, s));
    return play.timeScale;
  };

  // Rebuilds the pre-snap state in place. Initial state is this same routine.
  play.reset = () => {
    play.players = buildLineup(los, playKey, {
      front: play.front,
      dlShift: play.dlShift * DL_SHIFT_STEP,
      lbShift: play.lbShift * LB_SHIFT_STEP,
    });
    initFacing(play.players);
    // Pre-snap read: computed only here, so shifts keep it in sync with the lineup.
    const def = PLAYS[playKey];
    play.numbers = def.playside
      ? numberPlay(play.players, { los, centerId: def.ball.start, playside: def.playside })
      : {};
    for (const p of play.players) p.block = null;
    ctx = { seq: 0 };
    play.combos = [];
    play.run = null;
    play.defense = null;
    play.separation = 0;
    Object.assign(play.ball, {
      holder: PLAYS[playKey].ball.start,
      phase: 'presnap',
      t: 0,
      from: null,
      to: null,
    });
    play.ticks = 0;
    play.result = null;
    play.alpha = 0;
    acc = 0;
    snapshotPrev();
  };

  play.snap = () => {
    if (play.ball.phase !== 'presnap') return false;
    Object.assign(play.ball, {
      phase: 'snapping',
      from: PLAYS[playKey].ball.start,
      to: PLAYS[playKey].ball.snapTo,
      holder: null,
      t: 0,
    });
    if (play.accel) for (const p of play.players) p.v = 0;
    acc = 0;
    snapshotPrev();
    let plan = null;
    if (scheme) {
      plan = scheme.plan(play.players, play.numbers, los);
      play.combos = plan.combos;
      ctx.combos = plan.combos;
      ctx.side = plan.side;
      assignBlocks(play.players, plan.blocks, plan.techs);
    } else {
      assignBlocks(play.players);
    }
    const def = PLAYS[playKey];
    if (def.run) {
      play.run = startRun(play.players, def.run, { snapToId: def.ball.snapTo, playside: def.playside, numbers: play.numbers });
      play.defense = startDefense(play.players, plan?.front ?? readFront(play.players, play.numbers, los), {
        los,
        carrierId: play.run.carrier,
      });
    }
    return true;
  };

  const live = () => play.ball.phase !== 'presnap';

  play.engage = (blockerId, targetId, angle = 'straight') =>
    live() && setBlock(play.players, blockerId, targetId, angle);

  play.join = (blockerId, teammateId, angle) => {
    if (!live()) return false;
    const mate = play.player(teammateId);
    if (!mate || !isBlocker(mate) || !mate.block) return false;
    return play.engage(blockerId, mate.block.target, angle ?? mate.block.angle);
  };

  play.disengage = (blockerId) => live() && clearBlock(play.players, blockerId);

  play.blockersOf = (defenderId) =>
    live() ? engagedOn(play.players, defenderId).map((p) => p.id) : [];

  const advance = (sdt) => {
    const ball = play.ball;
    if (ball.phase === 'dead') return;
    if (ball.phase === 'snapping') {
      ball.t += sdt / SNAP_DURATION;
      if (ball.t >= 1 - 1e-9) {
        ball.t = 1;
        ball.holder = ball.to;
        ball.phase = 'held';
      }
    }
    if (ball.phase === 'presnap') return;
    const starts = play.accel ? play.players.map((p) => [p.x, p.y]) : null;
    if (play.run) {
      const handed = stepCarrier(
        play.players,
        play.run,
        { los, ballHeld: ball.phase === 'held', holdId: PLAYS[playKey].ball.snapTo },
        sdt,
      );
      if (handed) {
        ball.holder = play.run.carrier;
        ball.phase = 'carried';
      }
    }
    ctx.defGoals = play.defense
      ? stepDefense(play.players, play.defense, { run: play.run, ballPos: play.ballPosition() }, sdt)
      : null;
    ctx.committed = play.defense ? play.defense.committed : null;
    ctx.rule = play.retargetRule;
    ctx.fightBlocks = play.fightBlocks;
    play.separation += stepBlocking(play.players, play.ballPosition(), sdt, ctx);
    if (starts) {
      play.players.forEach((p, i) => {
        // Inertia: speed may fall no faster than the ramp rises (ACCEL_TAU), so a
        // substep clipped by contact does not ratchet the next cap down to a crawl.
        const moved = Math.hypot(p.x - starts[i][0], p.y - starts[i][1]) / sdt;
        p.v = Math.min(p.speed, Math.max(moved, p.v * Math.exp(-sdt / ACCEL_TAU)));
      });
    }
    stepFacing(play.players, play.prev, sdt);
    if (play.tackles && ball.phase === 'carried') {
      const end = playEnd(play.players, play.run.carrier);
      if (end) {
        const c = play.player(play.run.carrier);
        ball.phase = 'dead';
        play.result = {
          reason: end.reason,
          by: end.by,
          spot: { x: c.x, y: c.y },
          yards: c.y - los,
          time: (play.ticks + 1) * FIXED_DT,
        };
      }
    }
  };

  // Fixed-tick clock: whole FIXED_DT ticks from an accumulator, so the result
  // does not depend on the frame rate or time scale the caller steps with.
  play.step = (dt) => {
    if (play.ball.phase === 'presnap') return;
    acc += dt * play.timeScale;
    let n = 0;
    while (acc >= FIXED_DT - 1e-9 && n < MAX_TICKS_PER_STEP) {
      snapshotPrev();
      advance(FIXED_DT);
      acc -= FIXED_DT;
      play.ticks += 1;
      n++;
    }
    if (acc >= FIXED_DT - 1e-9) acc = 0; // runaway frame: drop the excess
    if (acc < 0) acc = 0;
    play.alpha = Math.min(acc / FIXED_DT, 1 - 1e-12);
  };

  play.ballPosition = () => {
    const { holder, from, to, t } = play.ball;
    if (holder) {
      const h = play.player(holder);
      return { x: h.x, y: h.y };
    }
    const a = play.player(from);
    const b = play.player(to);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  play.reset();
  return play;
}
