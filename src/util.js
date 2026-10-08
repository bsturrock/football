export const HW = 26.665, MAX_DRIVES = 6, PX = 16;
// B-021: the body scale pair (players.js draws every body with it, physics.js builds its boxes from it) and the radius within which bodies count as a pile.
// Here, with no imports, so sim.js can read them before the seed (it must not import players.js).
export const BODY_H = 0.92, BODY_W = 0.7, PILE_R = 1.3*BODY_W;
// B-031: two hip-to-hip distances for a locked blocker and defender. LOCK_D is the simulated one (blocking.js CONTACT_D): the lock, the reach and tackle radii and the run band
// are all tuned on it. BLOCK_D is the drawn one (animation.js): the crouched pose puts each man's pad front about 0.6-0.7 yd and his helmet about 0.83 yd ahead of his hip, so two
// men 0.75 apart pass through each other; at 1.4 the plates meet with the hands between them. Each man is drawn pushed (BLOCK_D - LOCK_D)/2 back along the pair axis.
export const LOCK_D = BODY_W + 0.05, BLOCK_D = 1.4;
export const $ = id => document.getElementById(id);
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
export const rand = (a,b) => a + Math.random()*(b-a);
// B-091: ratings and roster weights draw here, not from play logic's Math.random. Under ?sim, sim.js seedRandom installs a second mulberry32 (setRateStream); otherwise it reads Math.random as before.
let rateStream = null;
export const setRateStream = f => { rateStream = f; };
export const rrand01 = () => rateStream ? rateStream() : Math.random();
export const rrand = (a,b) => a + rrand01()*(b-a);
export const sigmoid = x => 1/(1 + Math.exp(-x));
// B-021: LEAN_LAT, DBL_R and HOLD_R are body-size distances, each x0.7 (the width scale in players.js: 1.0 -> 0.7, 1.4 -> 1.0, 1.8 -> 1.26).
// B-020 square + lean: the yaw a player wants from his faceAt (a blocker his man, a blocked defender his blocker).
// Square is the bearing to the target. In a run play an engaged pair (p.bt links them; no puller or kick-out man) also turns off
// square by the same yaw, FACE_LEAN_MAX * clamp(lat / LEAN_LAT, 0, 1), so the pair rotates as a unit and stays chest to chest
// (the two headings stay opposite). The turn is toward the runner side for the blocker: lat is the pair's sideways offset
// (|blocker x - defender x|, LEAN_LAT yd or more is full lean), the side is the runner's x against the pair's midpoint.
// Worked case: yaw = atan2(dx, -dy), heading (sin yaw, -cos yaw); blocker (0,0) facing defender (0,1), runner at +x: the blocker's
// square yaw is PI (heading (0,1)), lean -L gives PI-L, heading (sin L, cos L), chest toward +x; the defender's square yaw is 0, lean -L
// gives -L, heading (-sin L, -cos L), exactly opposite the blocker's. Pass sets, pullers, tacklers and physics bodies (the lean would change collisions, not just the look) face square.
// animation.js and physics.js physYaw and sim.js all call faceYaw; ball is state.js's ball (the runner is its holder), S is state.js's S (runMode, clock).
export const FACE_LEAN_MAX = 20*Math.PI/180, LEAN_LAT = 0.7, DBL_R = 1.0, HOLD_R = 1.26, LEAN_SIDE = 0.7, FACE_RATE = 14;   // HOLD_R: how close a blocker and the defender he is assigned to must be to count as a pair for the lean (faceLean);  DBL_R: how far a second blocker can be and still count as double-teaming (defense.js nearBlocker, sim.js)
export const bearing = (p, t) => Math.atan2(t.x - p.x, p.y - t.y);
export function faceLean(p, t, ball, S){
  const blocker = p.team === 'O' ? p : t, defender = p.team === 'O' ? t : p;
  const paired = (p.bt && (p.bt.o === t || p.bt.o === p)) || (blocker.blk === defender && Math.hypot(p.x - t.x, p.y - t.y) < HOLD_R);
  if(!S.runMode || !paired || p.ph || blocker.pull || ball.state !== 'held' || ball.holder.role === 'QB') return 0;   // before the handoff the runner is the QB: square, no lean toward him
  const lat = Math.abs(p.x - t.x), side = clamp((ball.holder.x - (p.x + t.x)/2)/LEAN_SIDE, -1, 1);   // B-022: the side ramps through zero over LEAN_SIDE yd either way of the pair midpoint (a sign would snap +-FACE_LEAN_MAX as the runner crosses it)
  return -side*FACE_LEAN_MAX*clamp(lat/LEAN_LAT, 0, 1);
}
// The yaw p wants from his faceAt, or null (then he faces where he moves). B-023: a defender's faceAt is set only while his battle lives (defense.js)
// and cleared when it ends, so there is no hold-through-a-gap rule; a fresh bubble body whose block ended has no faceAt either.
export function faceYaw(p, ball, S){
  const t = p.faceAt;
  if(!t || (p.team === 'D' && !p.bt && !p.latch && t.team === 'O')) return null;
  return bearing(p, t) + faceLean(p, t, ball, S);
}
