import { RECV } from './players.js';
import { scene, toWorld } from './scene.js';

// ---------- ball + markers ----------
export const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshLambertMaterial({color:0x7a3e1d}));
ballMesh.scale.set(1, 1, 1.75);
scene.add(ballMesh);
const flat = (geo, c, op=1) => { const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:op, depthWrite:false})); m.rotation.x = -Math.PI/2; m.position.y = 0.05; scene.add(m); return m; };
export const ctrlRing = flat(new THREE.RingGeometry(0.75, 0.95, 32), 0xffd21f, .95);
export const aimRing = flat(new THREE.RingGeometry(0.9, 1.15, 32), 0xffffff, .9);
export const landRing = flat(new THREE.RingGeometry(1.1, 1.4, 32), 0xffd21f, .85);
export const ARC_N = 28;
export const arcGeo = new THREE.BufferGeometry();
arcGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((ARC_N+1)*3), 3));
export const arcLine = new THREE.Line(arcGeo, new THREE.LineBasicMaterial({color:0xffffff, transparent:true, opacity:.55}));
scene.add(arcLine);
// route preview ribbons
const routeMat = new THREE.MeshBasicMaterial({color:0xffe066, transparent:true, opacity:.6, depthWrite:false});
export const routeGroup = new THREE.Group();
scene.add(routeGroup);
function seg(a, b, w, material=routeMat, group=routeGroup){
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if(len < 0.05) return;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, len), material);
  m.rotation.order = 'YXZ'; m.rotation.x = -Math.PI/2; m.rotation.y = Math.atan2(-dx, dy);
  m.position.copy(toWorld((a.x+b.x)/2, (a.y+b.y)/2, 0.04)); group.add(m);
}
// B-068 pre-snap blocking preview: a solid line from each blocker to the man he will block, a dotted one from a double's climber to his second-level target
// three.js draws a uuid from Math.random for every object it makes: quiet() keeps these overlay objects off the seeded stream (?sim stays identical to a build without them)
const quiet = fn => { const r = Math.random; Math.random = () => 0.5; try { return fn(); } finally { Math.random = r; } };
const blockMat = new THREE.MeshBasicMaterial({color:0x4fd2ff, transparent:true, opacity:.8, depthWrite:false});   // one material and one group, like the fit lines before: the same two uuid draws at load
export const blockGroup = new THREE.Group();
scene.add(blockGroup);
const BLOCK_W = 0.4, DASH = 0.5, GAP = 0.4;
function dotted(a, b, w, material, group){
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  for(let t = 0; t < len; t += DASH + GAP){ const e = Math.min(t + DASH, len); seg({x:a.x + dx*t/len, y:a.y + dy*t/len}, {x:a.x + dx*e/len, y:a.y + dy*e/len}, w, material, group); }
}
export function drawBlocks(pv){   // pv: blockrules.js previewBlocks {solid, dotted}, or null for a pass play
  blockGroup.children.forEach(c => c.geometry.dispose()); blockGroup.clear();
  if(pv) quiet(() => { for(const l of pv.solid) seg(l.p, l.d, BLOCK_W, blockMat, blockGroup); for(const l of pv.dotted) dotted(l.p, l.d, BLOCK_W, blockMat, blockGroup); });
  blockGroup.visible = true;
}
export function drawRoutes(){
  routeGroup.children.forEach(c => c.geometry.dispose()); routeGroup.clear();
  for(const w of RECV){
    let prev = {x:w.x, y:w.y};
    for(const p of w.route){ seg(prev, p, 0.3); prev = p; }
    if(w.go) seg(prev, {x:prev.x + w.goDir.x*6, y:prev.y + w.goDir.y*6}, 0.3);
  }
}
