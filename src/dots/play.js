// Dots play state: lineup positions and ball possession. Pure: no THREE, no DOM.
// Time advances only through step(dt); there are no timers or clocks here.

import { PLAYS, buildLineup } from './roster.js';
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

export function createPlay(los = 25, playKey = 'base', { timeScale = 1 } = {}) {
  const play = {
    los,
    playKey,
    players: [],
    ball: {},
    retargetRule: doubleTeamPeel,
    timeScale,
    dlShift: 0,
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

  // Scales how fast play.step advances; the only place time scale applies.
  play.setTimeScale = (s) => {
    if (!Number.isFinite(s)) return play.timeScale;
    play.timeScale = Math.min(SIM_SPEED_MAX, Math.max(SIM_SPEED_MIN, s));
    return play.timeScale;
  };

  // Rebuilds the pre-snap state in place. Initial state is this same routine.
  play.reset = () => {
    play.players = buildLineup(los, playKey, { dlShift: play.dlShift * DL_SHIFT_STEP });
    for (const p of play.players) p.block = null;
    ctx = { seq: 0 };
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
    assignBlocks(play.players);
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
