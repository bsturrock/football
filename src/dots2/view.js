// Dots v2 view: the line only (5 OL, 4 DL, 2 LB) as motionless dots on the field. Renders once
// after building and again on resize; no animation loop, no input, no sim state.
// Imports only ./lineup.js, ../dots/geometry.js and ../util.js (see test/dots2-lineup.test.js).
import { LOS, dots2Lineup } from './lineup.js';
import { BODY_RADIUS } from '../dots/geometry.js';
import { HW } from '../util.js';

// Yards visible each way on the shorter screen axis.
const VIEW_HALF = 8;
const CENTER_Y = LOS + 1;

// Field constants copied from src/dots/view.js (same values, not imported).
const YARD_LINE_W = 1 / 9; // 4 in
const GOAL_LINE_W = 2 / 9; // 8 in
const HASH_HALF = 18.5 / 6; // hashes 18 ft 6 in apart, centered
const HASH_LEN = 2 / 3; // 2 ft tick
const BORDER_W = 2; // 6 ft white border
const UPRIGHTS_W = 18.5 / 3; // goal posts 18 ft 6 in apart
const BG_COLOR = 0x10200f;

const OFFENSE_COLOR = 0x2f6bff, DEFENSE_COLOR = 0xe23b3b;
const DOT_LIFT = 0.1, LABEL_LIFT = 0.13, LABEL_DY = 0.6;
const LABEL_W = 1.0, LABEL_H = 0.5; // yards; room for three-letter ids

// The one source for dot colours.
export function dotColor(team) {
  return team === 'offense' ? OFFENSE_COLOR : DEFENSE_COLOR;
}

export function fieldToWorld(x, y) {
  return { x, z: 50 - y };
}

function idTexture(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  g.font = 'bold 72px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 10;
  g.strokeStyle = '#000';
  g.lineJoin = 'round';
  g.strokeText(text, c.width / 2, c.height / 2);
  g.fillStyle = '#fff';
  g.fillText(text, c.width / 2, c.height / 2);
  return new THREE.CanvasTexture(c);
}

export function initDots2View(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG_COLOR);

  const centerZ = fieldToWorld(0, CENTER_Y).z;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  camera.position.set(0, 100, centerZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, centerZ);

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    if (w >= h) {
      camera.top = VIEW_HALF;
      camera.bottom = -VIEW_HALF;
      camera.right = VIEW_HALF * aspect;
      camera.left = -camera.right;
    } else {
      camera.right = VIEW_HALF;
      camera.left = -VIEW_HALF;
      camera.top = VIEW_HALF / aspect;
      camera.bottom = -camera.top;
    }
    camera.updateProjectionMatrix();
  }

  function draw() {
    renderer.render(scene, camera);
  }

  // ---- Field ----
  function flat(w, h, color, x, y, lift) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    const p = fieldToWorld(x, y);
    m.position.set(p.x, lift, p.z);
    scene.add(m);
    return m;
  }
  flat(2 * HW, 120, 0x2e7d32, 0, 50, 0);
  flat(2 * HW, 10, 0x1b4f8a, 0, -5, 0.01);
  flat(2 * HW, 10, 0x8a1b1b, 0, 105, 0.01);
  for (let y = 0; y <= 100; y += 5) {
    const goal = y === 0 || y === 100;
    flat(2 * HW, goal ? GOAL_LINE_W : YARD_LINE_W, 0xffffff, 0, y, 0.02);
  }
  for (let y = 1; y <= 99; y++) {
    if (y % 5 === 0) continue;
    flat(HASH_LEN, YARD_LINE_W, 0xffffff, -HASH_HALF, y, 0.02);
    flat(HASH_LEN, YARD_LINE_W, 0xffffff, HASH_HALF, y, 0.02);
  }
  flat(BORDER_W, 120 + 2 * BORDER_W, 0xffffff, -(HW + BORDER_W / 2), 50, 0.02);
  flat(BORDER_W, 120 + 2 * BORDER_W, 0xffffff, HW + BORDER_W / 2, 50, 0.02);
  flat(2 * HW + 2 * BORDER_W, BORDER_W, 0xffffff, 0, -10 - BORDER_W / 2, 0.02);
  flat(2 * HW + 2 * BORDER_W, BORDER_W, 0xffffff, 0, 110 + BORDER_W / 2, 0.02);
  flat(UPRIGHTS_W, 0.15, 0xffd400, 0, -10, 0.03);
  flat(UPRIGHTS_W, 0.15, 0xffd400, 0, 110, 0.03);
  flat(2 * HW, 0.3, 0xffd400, 0, LOS, 0.03);

  // ---- Dots and id labels (built once; the players never move) ----
  const dotGeo = new THREE.CircleGeometry(BODY_RADIUS, 24);
  const labelGeo = new THREE.PlaneGeometry(LABEL_W, LABEL_H);
  for (const p of dots2Lineup()) {
    const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: dotColor(p.team) }));
    dot.rotation.x = -Math.PI / 2;
    const d = fieldToWorld(p.x, p.y);
    dot.position.set(d.x, DOT_LIFT, d.z);
    scene.add(dot);

    const label = new THREE.Mesh(labelGeo, new THREE.MeshBasicMaterial({
      map: idTexture(p.id), transparent: true, depthWrite: false }));
    label.rotation.x = -Math.PI / 2;
    const l = fieldToWorld(p.x, p.y + (p.team === 'offense' ? -LABEL_DY : LABEL_DY));
    label.position.set(l.x, LABEL_LIFT, l.z);
    scene.add(label);
  }

  window.addEventListener('resize', () => {
    resize();
    draw();
  });
  resize();
  draw();
}
