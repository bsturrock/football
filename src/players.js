import { scene } from './scene.js';
import { BODY_H, BODY_W } from './util.js';
import { bindSlots, rateRosters, subIn } from './roster.js';

// ---------- players ----------
// boxy jointed figure; every limb geometry hangs down from its pivot
// B-021: the rig is drawn at 1 unit = 1 yd but its numbers below are the old 2.3 yd figure; one scale pair turns them into an NFL body
// (about 2.1 yd with helmet, 0.7 yd at the pads). BODY_H scales every vertical size and offset, BODY_W every width, depth and sideways offset.
// physics.js applies the same pair to its boxes (PARTS) so mesh and collider stay one shape.
export { BODY_H, BODY_W };   // the pair itself lives in util.js
export const box = (w, h, d, x=0, y=-h/2, z=0) => new THREE.BoxGeometry(w*BODY_W, h*BODY_H, d*BODY_W).translate(x*BODY_W, y*BODY_H, z*BODY_W);
export const bodyV = ([x, y, z]) => [x*BODY_W, y*BODY_H, z*BODY_W];   // a rig-unit offset or size (x, y, z) in yards
export const G = {
  torso: box(0.75,0.7,0.42,0,0.37), pads: box(1.05,0.22,0.5,0,0.7), helmet: box(0.46,0.44,0.5,0,0.24),
  stripe: box(0.08,0.46,0.54,0,0.25), mask: box(0.36,0.14,0.08,0,0.18,0.27),
  upperArm: box(0.2,0.42,0.22), forearm: box(0.18,0.4,0.2),
  thigh: box(0.28,0.5,0.3), shin: box(0.24,0.45,0.26), cleat: box(0.24,0.1,0.38,0,-0.5,0.06),
  shadow: new THREE.CircleGeometry(0.62*BODY_W,20)
};
const shadowMat = new THREE.MeshBasicMaterial({color:0x000000, transparent:true, opacity:.28, depthWrite:false});
export const TEAM = {
  O: {jersey:0xd94a2b, pants:0xf3efe6, helmet:0xb8361e, stripe:0xffffff, socks:0xd94a2b},
  D: {jersey:0x1f3c7a, pants:0xc9cfdc, helmet:0x15295a, stripe:0xffd21f, socks:0x1f3c7a}
};
const SKIN = [0x5c3a1e, 0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d];
// jersey number on the back: one canvas texture per number, shared; a body swaps its map when a sub changes his number
// three.js draws Math.random for object uuids; the number art does that on a private stream so a seeded ?sim line is the same with or without it
let qk = 12345;
const quiet = f => { const r = Math.random; Math.random = () => (qk = qk*16807 % 2147483647)/2147483647; try { return f(); } finally { Math.random = r; } };
const numTex = {};
const numTexture = n => numTex[n] || (numTex[n] = quiet(() => {
  const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d');
  x.font = 'bold 42px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.fillText(String(n), 32, 26);
  return new THREE.CanvasTexture(c);
}));
G.numPlane = quiet(() => new THREE.PlaneGeometry(0.5*BODY_W, 0.375*BODY_H));
const mats = {};
export const mat = c => mats[c] || (mats[c] = new THREE.MeshLambertMaterial({color:c}));
export const JOINTS = ['lean','twist','hipL','hipR','kneeL','kneeR','shL','shR','elL','elR','drop','pitch','bob'];
function makePlayer(team, role){
  const t = TEAM[team], skin = SKIN[Math.floor(Math.random()*SKIN.length)];
  const g = new THREE.Group(), body = new THREE.Group();
  const pivot = (parent, x, y, z=0) => { const p = new THREE.Group(); p.position.set(...bodyV([x, y, z])); parent.add(p); return p; };
  const add = (parent, geo, c) => parent.add(new THREE.Mesh(geo, mat(c)));
  const torso = pivot(body, 0, 1.0);
  add(torso, G.torso, t.jersey); add(torso, G.pads, t.jersey);
  const numMat = quiet(() => new THREE.MeshBasicMaterial({map:numTexture(0), transparent:true, depthWrite:false}));
  quiet(() => { const m = new THREE.Mesh(G.numPlane, numMat); m.position.set(...bodyV([0, 0.4, -0.216])); m.rotation.y = Math.PI; torso.add(m); });
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
  return {team, role, skin, setNum:n => { numMat.map = numTexture(n); }, mesh:g, body, j:{torso, head, shL, elL, shR, elR, hipL, kneeL, hipR, kneeR}, pose,
          x:0, y:0, vx:0, vy:0, spd:7, stun:0, acc:5, brake:7.5, turn:6, accel:0, stride:Math.random()*6, face:0, act:null, actT:0, eng:0};
}
// Twenty-two fixed bodies (every body shares one geometry, so a sub adds nothing to the scene). subIn (src/roster.js) copies roster
// records onto them between plays and refills the group arrays in place: WRs, EXTRA (a fullback or second tight end), RECV and ROUTE_KEYS
// on offense; DL, LBs, CBs and SFs on defense. QB, LT..RT, TE and RB stay named slots; OFF, DEF and ALL never change.
export const QB = makePlayer('O','QB');
export const LT = makePlayer('O','OL'), LG = makePlayer('O','OL'), C = makePlayer('O','OL'), RG = makePlayer('O','OL'), RT = makePlayer('O','OL');
const FLEX = [makePlayer('O','WR'), makePlayer('O','WR'), makePlayer('O','WR')];   // WR, WR, WR | WR, WR, TE2 | WR, WR, FB | WR, TE2, FB
export const TE = makePlayer('O','WR'), RB = makePlayer('O','WR');
export const OL = [LT, LG, C, RG, RT], WRs = [], EXTRA = [], RECV = [], ROUTE_KEYS = [];
export const OFF = [QB, ...OL, ...FLEX, TE, RB];
const DB = [...Array(4)].map(() => makePlayer('D','DL')).concat([...Array(2)].map(() => makePlayer('D','LB')), [...Array(3)].map(() => makePlayer('D','CB')), [...Array(2)].map(() => makePlayer('D','S')));
export const DL = [], LBs = [], CBs = [], SFs = [];
export const DEF = DB, ALL = [...OFF, ...DEF];
// ratings: nine 0-99 per record from a position template (src/ratings.js), 46 records a team; newGame draws them again
export const rate = () => rateRosters();
bindSlots({QB, OL, TE, RB, flex:FLEX, WRs, EXTRA, RECV, ROUTE_KEYS, DEF:DB, DL, LBs, CBs, SFs});
rate();
subIn();   // default 11 personnel and nickel: today's twenty-two
