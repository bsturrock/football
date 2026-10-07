export const HW = 26.665, MAX_DRIVES = 6, PX = 16;
export const $ = id => document.getElementById(id);
export const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
export const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
export const rand = (a,b) => a + Math.random()*(b-a);
export const sigmoid = x => 1/(1 + Math.exp(-x));
// B-020 square + lean: the yaw a player wants when facing t (a blocker his man, a blocked defender his blocker).
// Square is the bearing to t; the lean turns each off square by FACE_LEAN_MAX * clamp(lat / LEAN_LAT, -1, 1), the
// blocker toward the runner side and the defender the opposite way, so the pair leans into each other. lat is the
// runner's sideways offset from the pair's midpoint (rx = the runner's x). animation.js and physics.js physYaw both call this.
export const FACE_LEAN_MAX = 20*Math.PI/180, LEAN_LAT = 0.6;
export const bearing = (p, t) => Math.atan2(t.x - p.x, p.y - t.y);
export function faceLean(p, t, rx){
  const lat = rx - (p.x + t.x)/2;
  return (p.team === 'O' ? 1 : -1)*FACE_LEAN_MAX*clamp(lat/LEAN_LAT, -1, 1);
}
export const faceYaw = (p, t, rx) => bearing(p, t) + faceLean(p, t, rx);
