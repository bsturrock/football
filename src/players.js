import { scene } from './scene.js';
import { rand } from './util.js';

// ---------- players ----------
// boxy jointed figure; every limb geometry hangs down from its pivot
export const box = (w, h, d, x=0, y=-h/2, z=0) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
export const G = {
  torso: box(0.75,0.7,0.42,0,0.37), pads: box(1.05,0.22,0.5,0,0.7), helmet: box(0.46,0.44,0.5,0,0.24),
  stripe: box(0.08,0.46,0.54,0,0.25), mask: box(0.36,0.14,0.08,0,0.18,0.27),
  upperArm: box(0.2,0.42,0.22), forearm: box(0.18,0.4,0.2),
  thigh: box(0.28,0.5,0.3), shin: box(0.24,0.45,0.26), cleat: box(0.24,0.1,0.38,0,-0.5,0.06),
  shadow: new THREE.CircleGeometry(0.62,20)
};
const shadowMat = new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:.28, depthWrite:false});
export const TEAM = {
  O: {jersey:0xd94a2b, pants:0xf3efe6, helmet:0xb8361e, stripe:0xffffff, socks:0xd94a2b},
  D: {jersey:0x1f3c7a, pants:0xc9cfdc, helmet:0x15295a, stripe:0xffd21f, socks:0x1f3c7a}
};
const SKIN = [0x5c3a1e, 0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d];
const mats = {};
export const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({color:c}));
export const JOINTS = ['lean','twist','hipL','hipR','kneeL','kneeR','shL','shR','elL','elR','drop','pitch','bob'];
function makePlayer(team, role){
  const t = TEAM[team], skin = SKIN[Math.floor(Math.random()*SKIN.length)];
  const g = new THREE.Group(), body = new THREE.Group();
  const pivot = (parent, x, y, z=0) => { const p = new THREE.Group(); p.position.set(x, y, z); parent.add(p); return p; };
  const add = (parent, geo, c) => parent.add(new THREE.Mesh(geo, mat(c)));
  const torso = pivot(body, 0, 1.0);
  add(torso, G.torso, t.jersey); add(torso, G.pads, t.jersey);
  const head = pivot(torso, 0, 0.8);
  add(head, G.helmet, t.helmet); add(head, G.stripe, t.stripe); add(head, G.mask, 0x222222);
  const arm = side => { // side: +1 left (+x), -1 right (-x)
    const sh = pivot(torso, side*0.5, 0.62); add(sh, G.upperArm, t.jersey);
    const el = pivot(sh, 0, -0.42); add(el, G.forearm, skin);
    return [sh, el];
  };
  const leg = side => {
    const hip = pivot(body, side*0.2, 1.0); add(hip, G.thigh, t.pants);
    const knee = pivot(hip, 0, -0.5); add(knee, G.shin, t.socks); add(knee, G.cleat, 0x1a1a1a);
    return [hip, knee];
  };
  const [shL, elL] = arm(1), [shR, elR] = arm(-1), [hipL, kneeL] = leg(1), [hipR, kneeR] = leg(-1);
  const sh = new THREE.Mesh(G.shadow, shadowMat); sh.rotation.x = -Math.PI/2; sh.position.y = 0.035;
  g.add(body, sh); scene.add(g);
  const pose = {}; JOINTS.forEach(j => pose[j] = 0);
  return {team, role, skin, mesh:g, body, j:{torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR}, pose,
          x:0, y:0, vx:0, vy:0, spd:7, stun:0, acc:5, brake:7.5, turn:6, accel:0, stride:Math.random()*6, face:0, act:null, actT:0, eng:0};
}
export const QB = makePlayer('O','QB');
export const LT = makePlayer('O','OL'), LG = makePlayer('O','OL'), C = makePlayer('O','OL'), RG = makePlayer('O','OL'), RT = makePlayer('O','OL');
export const WRs = [makePlayer('O','WR'), makePlayer('O','WR'), makePlayer('O','WR')];
export const TE = makePlayer('O','WR'), RB = makePlayer('O','WR');
export const OL = [LT, LG, C, RG, RT], RECV = [...WRs, TE, RB], ROUTE_KEYS = ['out','out','slot','te','rb'];
export const OFF = [QB, ...OL, ...RECV];
export const DL = [makePlayer('D','DL'), makePlayer('D','DL'), makePlayer('D','DL'), makePlayer('D','DL')];
export const LBs = [makePlayer('D','LB'), makePlayer('D','LB')];
export const CBs = [makePlayer('D','CB'), makePlayer('D','CB'), makePlayer('D','CB')];
export const SFs = [makePlayer('D','S'), makePlayer('D','S')];
export const DEF = [...DL, ...LBs, ...CBs, ...SFs], ALL = [...OFF, ...DEF];
// ratings (kept for the whole game): blockers have strength / agility, defenders power / speed
{
  const R = (a, b) => Math.round(rand(a, b));
  const rate = (p, a, b, c, e) => { if(p.team === 'O'){ p.rStr = R(a, b); p.rAgi = R(c, e); } else { p.rPow = R(a, b); p.rSpd = R(c, e); } };
  OL.forEach(o => rate(o, 70, 90, 55, 80)); rate(TE, 60, 80, 60, 75); rate(RB, 55, 70, 60, 75);
  WRs.forEach(w => rate(w, 40, 60, 60, 80)); rate(QB, 35, 45, 45, 55);
  DL.forEach((d, i) => (i === 0 || i === 3) ? rate(d, 60, 80, 72, 90) : rate(d, 75, 92, 55, 70));   // ends: speed, tackles: power
  LBs.forEach(b => rate(b, 60, 75, 60, 78)); CBs.forEach(c => rate(c, 40, 60, 65, 85)); SFs.forEach(s => rate(s, 50, 65, 60, 80));
  // tackling: ball carriers have break-tackle (rBrk), defenders tackling (rTkl); mass in lb drives collisions
  const MASS = {RB:215, WR:195, TE:250, QB:220, OL:310, DT:305, DE:270, LB:240, CB:195, S:205};
  OFF.forEach(o => o.rBrk = o === RB ? R(65, 85) : o === TE ? R(65, 80) : o === QB ? R(40, 55) : R(50, 70));
  DEF.forEach(d => d.rTkl = d.role === 'LB' ? R(75, 90) : d.role === 'S' ? R(70, 85) : d.role === 'CB' ? R(60, 78) : R(65, 80));
  // awareness: how fast he reads the play and how cleanly he takes his angles
  DEF.forEach(d => d.rAwr = d.role === 'LB' || d.role === 'S' ? R(65, 90) : R(55, 80));
  // movement: [acceleration, cut/turn] in yd/s²; braking is 1.5x acceleration
  const MOVE = {RB:[7.2,13], WR:[6.5,8.5], TE:[6,6.5], QB:[5,6.5], OL:[5.6,5.5], DT:[5.8,6], DE:[6.2,7], LB:[5.8,7.5], CB:[6.5,8.5], S:[6,8]};
  ALL.forEach(p => {
    const key = p === RB ? 'RB' : p === TE ? 'TE' : p.role === 'DL' ? (p === DL[0] || p === DL[3] ? 'DE' : 'DT') : p.role;
    const [a, t] = MOVE[key];
    p.acc = a*rand(0.92, 1.08); p.brake = p.acc*1.5; p.turn = t*rand(0.92, 1.08);
    p.mass = MASS[key]*rand(0.95, 1.05);
  });
}
