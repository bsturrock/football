// Dots play state: lineup positions and ball possession. Pure: no THREE, no DOM.
// Time advances only through step(dt); there are no timers or clocks here.

import { PLAYS, buildLineup } from './roster.js';

export const SNAP_DURATION = 0.35; // seconds

export function createPlay(los = 25, playKey = 'base') {
  const play = { los, playKey, players: [], ball: {} };

  play.player = (id) => play.players.find((p) => p.id === id);

  // Rebuilds the pre-snap state in place. Initial state is this same routine.
  play.reset = () => {
    play.players = buildLineup(los, playKey);
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
    return true;
  };

  play.step = (dt) => {
    const ball = play.ball;
    if (ball.phase !== 'snapping') return;
    ball.t += dt / SNAP_DURATION;
    if (ball.t >= 1) {
      ball.t = 1;
      ball.holder = ball.to;
      ball.phase = 'held';
    }
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
