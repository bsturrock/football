import { scene } from './scene.js';
import { rateTeams } from './ratings.js';

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
// ratings: nine 0-99 per player from a position template (src/ratings.js); newGame draws them again
ALL.forEach(p => p.tpl = p === RB ? 'RB' : p === TE ? 'TE' : p.role === 'DL' ? (p === DL[0] || p === DL[3] ? 'DE' : 'DT') : p.role);
export const rate = () => rateTeams(ALL);
rate();
