export const HW = 26.665, MAX_DRIVES = 6, PX = 16;
export const $ = id => document.getElementById(id);
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
export const rand = (a,b) => a + Math.random()*(b-a);
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
export const FACE_LEAN_MAX = 20*Math.PI/180, LEAN_LAT = 0.7, DBL_R = 1.0, HOLD_R = 1.26, HOLD_T = 0.25, HOLD_V = 0.4;   // HOLD_R: a defender keeps squaring to his assigned blocker through a gap in the battle while he stays this close (HOLD_R yd), for at most HOLD_T s after the battle dropped, and only while the blocker is in front of him (his move direction, when he moves faster than HOLD_V);  DBL_R: how far a second blocker can be and still count as double-teaming (defense.js nearBlocker, sim.js)
export const bearing = (p, t) => Math.atan2(t.x - p.x, p.y - t.y);
// A defender between battle moments (his battle object is gone for a few frames while the pair is still locked up) still faces his assigned
// blocker; not after he beat him (freeT), not while he steps around him, not as a physics body (a bubble promote must not turn him back).
export const holdsBlocker = (d, S) => {
  const t = d.faceAt;
  if(!t || t.team !== 'O' || d.ph || t.blk !== d || Math.hypot(t.x - d.x, t.y - d.y) >= HOLD_R || (d.freeFrom === t && d.freeT > 0) || (d.avoid && d.avoid.st === 'avoid')) return false;
  const age = S.clock - (d.btAt ?? -Infinity);   // d.btAt: S.clock of his last battle frame (defense.js); a stale one from an earlier play has a negative age
  if(!(age >= 0 && age <= HOLD_T)) return false;
  return Math.hypot(d.vx, d.vy) <= HOLD_V || (t.x - d.x)*d.vx + (t.y - d.y)*d.vy > 0;   // the blocker is behind a man running away from him: let go
};
export function faceLean(p, t, ball, S){
  const blocker = p.team === 'O' ? p : t, defender = p.team === 'O' ? t : p;
  const paired = (p.bt && (p.bt.o === t || p.bt.o === p)) || (blocker.blk === defender && Math.hypot(p.x - t.x, p.y - t.y) < HOLD_R);
  if(!S.runMode || !paired || p.ph || blocker.pull || ball.state !== 'held' || ball.holder.role === 'QB') return 0;   // before the handoff the runner is the QB: square, no lean toward him
  const lat = Math.abs(p.x - t.x), side = Math.sign(ball.holder.x - (p.x + t.x)/2);
  return -side*FACE_LEAN_MAX*clamp(lat/LEAN_LAT, 0, 1);
}
// The yaw p wants from his faceAt, or null (then he faces where he moves). A defender whose block ended without his faceAt being
// cleared (a bubble promote nulls p.bt mid-step) must not keep squaring to his old blocker: that spun fresh bubble bodies toward him
// and cost about 1.2 ypc at ?sim=300 (seeds 7, 8).
export function faceYaw(p, ball, S){
  const t = p.faceAt;
  if(!t || (p.team === 'D' && t.team === 'O' && !p.bt && !p.latch && !holdsBlocker(p, S))) return null;
  return bearing(p, t) + faceLean(p, t, ball, S);
}
