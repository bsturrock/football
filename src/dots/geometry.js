// Shared body and ball geometry used by both decision modules (zone, defense) and movement/contact modules (blocking, steering), so decisions never import a movement module (PRINCIPLES #9).
// Pure: imports nothing.

// 0.56 yd = 20 in wide, the top of the 16-20 in shoulder range; area about 2.2 sq ft, between
// the 1.5 sq ft crush minimum and the 2.5-3 sq ft comfortable footprint.
export const BODY_RADIUS = 0.28;
// Tunable: yards the ball must be upfield of the target for the blocker to let go.
export const RELEASE_PAST = 4 * BODY_RADIUS;

// The ball is well upfield of him: a blocker lets go of him and may not engage him, and a climber stops chasing him (zone.js).
export function ballPast(T, ballPos) {
  return ballPos.y >= T.y + RELEASE_PAST;
}
