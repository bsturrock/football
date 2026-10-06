import { $, HW, PX } from './util.js';

// ---------- renderer / scene ----------
export const wrap = $('game');
export const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
wrap.appendChild(renderer.domElement);
export const cvs = renderer.domElement;
cvs.tabIndex = 0;
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0c1512);
scene.fog = new THREE.Fog(0x0c1512, 80, 180);
export const camera = new THREE.PerspectiveCamera(52, 1, 0.5, 500);
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a4030, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(-20, 50, 20);
scene.add(sun);
function resize(){ const w = wrap.clientWidth, h = wrap.clientHeight; renderer.setSize(w, h); camera.aspect = w/h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);
resize();
// game coords: x = lateral (yards from center), y = yard line (0 own goal, 100 opponent goal)
export const toWorld = (x, y, h=0) => new THREE.Vector3(x, h, 50 - y);
// ---------- field ----------
const fieldCanvas = document.createElement('canvas');
fieldCanvas.width = Math.round(HW*2*PX);
fieldCanvas.height = 120*PX;
const fieldTex = new THREE.CanvasTexture(fieldCanvas);
fieldTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
function drawField(){
  const g = fieldCanvas.getContext('2d'), w = fieldCanvas.width;
  const Y = yd => (110 - yd)*PX, X = x => (x + HW)*PX;
  for(let yd = 0; yd < 100; yd += 5){ g.fillStyle = (yd/5)%2 ? '#2f7a3a' : '#2a6f35'; g.fillRect(0, Y(yd+5), w, 5*PX); }
  g.fillStyle = '#9b2f1f'; g.fillRect(0, Y(0), w, 10*PX);
  g.fillStyle = '#1f3c7a'; g.fillRect(0, 0, w, 10*PX);
  g.fillStyle = '#fff';
  for(let yd = 0; yd <= 100; yd += 5){ const t = (yd%50===0) ? 6 : 3; g.fillRect(0, Y(yd)-t/2, w, t); }
  for(let yd = 1; yd < 100; yd++){ if(yd%5===0) continue;
    for(const x of [-HW+0.4, -3.08, 3.08, HW-1.0]) g.fillRect(X(x), Y(yd)-1, 0.6*PX, 2); }
  g.fillRect(0, 0, 6, fieldCanvas.height); g.fillRect(w-6, 0, 6, fieldCanvas.height);
  g.fillRect(0, 0, w, 6); g.fillRect(0, fieldCanvas.height-6, w, 6);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `600 ${2.2*PX}px "Saira Condensed","Arial Narrow",sans-serif`;
  for(let yd = 10; yd < 100; yd += 10){
    const label = String(yd <= 50 ? yd : 100 - yd);
    for(const [x, rot] of [[-HW+9, Math.PI/2], [HW-9, -Math.PI/2]]){
      g.save(); g.translate(X(x), Y(yd)); g.rotate(rot); g.fillText(label, 0, 0); g.restore();
    }
  }
  g.font = `800 ${6*PX}px "Saira Condensed","Arial Narrow",sans-serif`;
  g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillText('HAWKS', w/2, Y(-5)); g.fillText('WOLVES', w/2, Y(105));
  fieldTex.needsUpdate = true;
}
drawField();
if(document.fonts) document.fonts.ready.then(drawField);
const field = new THREE.Mesh(new THREE.PlaneGeometry(HW*2, 120), new THREE.MeshLambertMaterial({map:fieldTex}));
field.rotation.x = -Math.PI/2;
scene.add(field);
const apron = new THREE.Mesh(new THREE.PlaneGeometry(220, 300), new THREE.MeshLambertMaterial({color:0x1a3a24}));
apron.rotation.x = -Math.PI/2;
apron.position.y = -0.02;
scene.add(apron);
// goalposts
const postMat = new THREE.MeshLambertMaterial({color:0xf2c81e});
for(const yd of [-10, 110]){
  const z = 50 - yd, gp = new THREE.Group();
  const up = new THREE.Mesh(new THREE.CylinderGeometry(0.15,0.15,3.3), postMat); up.position.set(0,1.65,0);
  const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,6.17), postMat); cross.rotation.z = Math.PI/2; cross.position.y = 3.3;
  const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1,0.1,10), postMat); l.position.set(-3.08, 8.3, 0);
  const r = l.clone(); r.position.x = 3.08;
  gp.add(up, cross, l, r); gp.position.z = z; scene.add(gp);
}
// line of scrimmage + first-down line
const stripe = c => { const m = new THREE.Mesh(new THREE.PlaneGeometry(HW*2, 0.35), new THREE.MeshBasicMaterial({color:c, transparent:true, opacity:.9, depthWrite:false})); m.rotation.x = -Math.PI/2; m.position.y = 0.02; scene.add(m); return m; };
export const losLine = stripe(0x3d8bff), fdLine = stripe(0xffd21f);
