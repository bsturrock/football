// Dots play state: lineup positions and ball possession. Pure: no THREE, no DOM.
// Ball phases: presnap -> snapping -> held -> carried (carried only on plays with a run).
// Time advances only through step(dt); there are no timers or clocks here.

import { PLAYS, buildLineup } from './roster.js';
import { numberPlay } from './numbering.js';
import { startRun, stepCarrier } from './carrier.js';
import { zonePlan, zoneSwitch } from './zone.js';
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

export const SNAP_DURATION = 0.35; // seconds
export const MAX_SUBSTEP = 1 / 60; // max sim seconds per stepBlocking call
export const SIM_SPEED = 0.35; // dots page default time scale
export const SIM_SPEED_MIN = 0.1;
export const SIM_SPEED_MAX = 2;
export const DL_SHIFT_STEP = BODY_RADIUS; // yards per pre-snap D-line shift step
export const DL_SHIFT_MAX = 4; // steps allowed each way
export const LB_SHIFT_STEP = BODY_RADIUS; // yards per pre-snap linebacker shift step
export const LB_SHIFT_MAX = 6; // steps allowed each way

const SCHEMES = Object.freeze({ zone: Object.freeze({ plan: zonePlan, rule: zoneSwitch }) });

export function createPlay(los = 25, playKey = 'base', { timeScale = 1 } = {}) {
  const scheme = SCHEMES[PLAYS[playKey].scheme] || null;
  const play = {
    los,
    playKey,
    players: [],
    ball: {},
    retargetRule: scheme ? scheme.rule : doubleTeamPeel,
    timeScale,
    dlShift: 0,
    lbShift: 0,
    numbers: {},
    combos: [],
    run: null,
  };
  let ctx = { seq: 0 };

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

  // Scales how fast play.step advances; the only place time scale applies.
  play.setTimeScale = (s) => {
    if (!Number.isFinite(s)) return play.timeScale;
    play.timeScale = Math.min(SIM_SPEED_MAX, Math.max(SIM_SPEED_MIN, s));
    return play.timeScale;
  };

  // Rebuilds the pre-snap state in place. Initial state is this same routine.
  play.reset = () => {
    play.players = buildLineup(los, playKey, {
      dlShift: play.dlShift * DL_SHIFT_STEP,
      lbShift: play.lbShift * LB_SHIFT_STEP,
    });
    // Pre-snap read: computed only here, so shifts keep it in sync with the lineup.
    const def = PLAYS[playKey];
    play.numbers = def.playside
      ? numberPlay(play.players, { los, centerId: def.ball.start, playside: def.playside })
      : {};
    for (const p of play.players) p.block = null;
    ctx = { seq: 0 };
    play.combos = [];
    play.run = null;
    play.separation = 0;
    Object.assign(play.ball, {
      holder: PLAYS[playKey].ball.start,
      phase: 'presnap',
      t: 0,
      from: null,
      to: null,
    });
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
    if (scheme) {
      const plan = scheme.plan(play.players, play.numbers, los);
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
    if (ball.phase === 'snapping') {
      ball.t += sdt / SNAP_DURATION;
      if (ball.t >= 1 - 1e-9) {
        ball.t = 1;
        ball.holder = ball.to;
        ball.phase = 'held';
      }
    }
    if (ball.phase === 'presnap') return;
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
    ctx.rule = play.retargetRule;
    play.separation += stepBlocking(play.players, play.ballPosition(), sdt, ctx);
  };

  play.step = (dt) => {
    const total = dt * play.timeScale;
    const n = Math.max(1, Math.ceil(total / MAX_SUBSTEP - 1e-9));
    for (let i = 0; i < n; i++) advance(total / n);
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
