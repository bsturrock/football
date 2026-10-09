// Dots view layer: top-down three.js rendering of the dots play state.
// Pure helpers are exported for tests; THREE/DOM are only touched in initDotsView.

import { createPlay, SIM_SPEED, DL_SHIFT_STEP, LB_SHIFT_STEP } from './play.js';
import { BODY_RADIUS } from './blocking.js';
import { HW } from '../util.js';

// Number label square covers the dot.
export const LABEL_SIZE = 2 * BODY_RADIUS;

const SHIFT_STEP = Object.freeze({ DL: DL_SHIFT_STEP, LB: LB_SHIFT_STEP });

// Yards with two decimals and trailing zeros dropped (0.35 -> '0.35', 0.7 -> '0.7', 2 -> '2').
export function formatYards(y) {
  return String(Number(y.toFixed(2)));
}

export function fieldToWorld(x, y) {
  return { x, z: 50 - y };
}

export function pickDot(players, gx, gy, radius) {
  let best = null;
  let bestD = Infinity;
  for (const p of players) {
    const d = Math.hypot(p.x - gx, p.y - gy);
    if (d <= radius && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

// Panel text for a player's block: the blocker's block, or the blockers on a defender.
export function blockSummary(play, id) {
  const p = play.player(id);
  if (!p) return '';
  if (p.team === 'offense') {
    if (!p.block) return 'Block: none';
    const state = p.block.engaged ? 'engaged' : 'closing';
    return `Block: ${p.block.target} · ${p.block.angle} · ${state}`;
  }
  const blockers = play.blockersOf(id);
  return `Blocked by: ${blockers.length ? blockers.join(', ') : 'none'}`;
}

// Hint text for the pre-snap D-line shift (steps: +1 = right, -1 = left).
export function shiftLabel(steps, group = 'DL', keys = '←/→') {
  if (steps === 0) return `${group} shift: even (${keys})`;
  const step = SHIFT_STEP[group] ?? DL_SHIFT_STEP;
  const yd = formatYards(Math.abs(steps) * step);
  const side = steps > 0 ? 'R' : 'L';
  return `${group} shift: ${yd} yd ${side} (${keys})`;
}

// Text for a player's zone-number label ('' hides it).
export function numberLabel(n) {
  return n === null || n === undefined ? '' : String(n);
}

// Text for the RB's hole read ('' hides it; play.run may be null or undefined before the snap).
export function runLabel(run) {
  if (!run || !run.carried) return '';
  return `Hole: ${run.gap} (${run.locked ? 'locked' : 'reading'})`;
}

export function initDotsView(container) {
  const play = createPlay(25, 'insideZone', { timeScale: SIM_SPEED });
  const tooltip = document.getElementById('tooltip');
  const panel = document.getElementById('info-panel');
  const resetBtn = document.getElementById('reset-btn');
  const hint = document.getElementById('hint');
  const speedReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  const showSpeed = () => {
    if (speedReadout) speedReadout.textContent = `Speed ${play.timeScale.toFixed(2)}x (-/+)`;
  };
  showSpeed();
  const shiftReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  const showShift = () => {
    if (shiftReadout) shiftReadout.textContent = shiftLabel(play.dlShift);
  };
  showShift();
  const lbReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  const showLB = () => {
    if (lbReadout) lbReadout.textContent = shiftLabel(play.lbShift, 'LB', '⇧←/→');
  };
  showLB();

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10200f);

  const HALF_H = 20; // ~40 yards tall at zoom 1
  const centerZ = 50 - 23;
  const camera = new THREE.OrthographicCamera(-1, 1, HALF_H, -HALF_H, 0.1, 300);
  camera.position.set(0, 100, centerZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, centerZ);

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
    const aspect = w / h;
    camera.left = -HALF_H * aspect;
    camera.right = HALF_H * aspect;
    camera.top = HALF_H;
    camera.bottom = -HALF_H;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

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
    const thick = y === 0 || y === 50 || y === 100;
    flat(2 * HW, thick ? 0.5 : 0.25, 0xffffff, 0, y, 0.02);
  }
  flat(0.5, 120, 0xffffff, -HW, 50, 0.02);
  flat(0.5, 120, 0xffffff, HW, 50, 0.02);
  flat(2 * HW, 0.3, 0xffd400, 0, play.los, 0.03);

  // ---- Dots ----
  const dotMeshes = new Map();
  const geo = new THREE.CircleGeometry(BODY_RADIUS, 24);
  for (const p of play.players) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: p.team === 'offense' ? 0x2f6bff : 0xe23b3b }));
    m.rotation.x = -Math.PI / 2;
    scene.add(m);
    dotMeshes.set(p.id, m);
  }

  // ---- Zone number labels ----
  const labels = new Map();
  function drawLabel(label, text) {
    const c = label.userData.canvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    if (text !== '') {
      g.font = 'bold 44px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = '#000';
      g.lineJoin = 'round';
      g.strokeText(text, c.width / 2, c.height / 2);
      g.fillStyle = '#fff';
      g.fillText(text, c.width / 2, c.height / 2);
    }
    label.userData.texture.needsUpdate = true;
    label.visible = text !== '';
  }
  for (const p of play.players) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_SIZE, LABEL_SIZE),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.userData = { canvas: c, texture: tex };
    m.visible = false;
    scene.add(m);
    labels.set(p.id, m);
  }
  let lastNumbers = null;
  function syncLabels() {
    if (play.numbers !== lastNumbers) {
      lastNumbers = play.numbers;
      for (const p of play.players) {
        drawLabel(labels.get(p.id), numberLabel(play.numbers[p.id]));
      }
    }
    for (const p of play.players) {
      const w = fieldToWorld(p.x, p.y);
      labels.get(p.id).position.set(w.x, 0.13, w.z);
    }
  }

  // ---- Block lines (blocker -> current target), keyed by blocker id ----
  const CLOSING_COLOR = 0x9e9e9e, ENGAGED_COLOR = 0xfff176;
  const blockLines = new Map();
  function blockLineFor(id) {
    let line = blockLines.get(id);
    if (!line) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: CLOSING_COLOR, transparent: true, opacity: 0.5 }));
      line.visible = false;
      scene.add(line);
      blockLines.set(id, line);
    }
    return line;
  }
  function syncBlockLines() {
    for (const p of play.players) {
      if (p.team !== 'offense') continue;
      if (!p.block) {
        const existing = blockLines.get(p.id);
        if (existing) existing.visible = false;
        continue;
      }
      const target = play.player(p.block.target);
      const line = blockLineFor(p.id);
      if (!target) { line.visible = false; continue; }
      const a = fieldToWorld(p.x, p.y);
      const b = fieldToWorld(target.x, target.y);
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, a.x, 0.12, a.z);
      pos.setXYZ(1, b.x, 0.12, b.z);
      pos.needsUpdate = true;
      const engaged = !!p.block.engaged;
      line.material.color.setHex(engaged ? ENGAGED_COLOR : CLOSING_COLOR);
      line.material.opacity = engaged ? 1 : 0.5;
      line.visible = true;
    }
  }

  // ---- Ball marker ----
  const ball = new THREE.Group();
  const outline = new THREE.Mesh(new THREE.CircleGeometry(0.38, 20),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.3, 20),
    new THREE.MeshBasicMaterial({ color: 0x8b4513 }));
  outline.rotation.x = fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.01;
  ball.add(outline, fill);
  ball.scale.set(1, 1, 1.4);
  scene.add(ball);

  // ---- Selection ring ----
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.75, 0.95, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let selectedId = null;

  function ballStatus() {
    const b = play.ball;
    if (b.phase === 'presnap') return `Ball: ${b.holder} (pre-snap)`;
    if (b.phase === 'snapping') return 'Ball: snapping…';
    return `Ball: ${b.holder}`;
  }

  let lastPanel = '';
  function updatePanel() {
    if (!panel) return;
    const sel = selectedId && play.player(selectedId);
    let html = '';
    if (sel) {
      const a = sel.assignment || {};
      const has = play.ball.holder === sel.id;
      html += `<div><b>${sel.id}</b> · ${sel.name}</div>` +
        `<div>Team: ${sel.team}</div><div>Role: ${sel.role}</div>` +
        `<div>Zone #: ${numberLabel(play.numbers[sel.id]) || 'none'}</div>` +
        `<div>Goal: ${a.goal ?? 'none'}</div>` +
        `<div>Target: ${a.target ?? 'none'}</div>` +
        `<div>${blockSummary(play, sel.id)}</div>` +
        `<div>${has ? 'Has the ball' : 'Does not have the ball'}</div>`;
    } else {
      html += '<div>Click a dot to select</div>';
    }
    html += `<div style="margin-top:6px">${ballStatus()}</div>`;
    const rl = runLabel(play.run); if (rl) html += `<div>${rl}</div>`;
    if (html !== lastPanel) { panel.innerHTML = html; lastPanel = html; }
  }

  function sync() {
    for (const p of play.players) {
      const m = dotMeshes.get(p.id);
      if (!m) continue;
      const w = fieldToWorld(p.x, p.y);
      m.position.set(w.x, 0.1, w.z);
    }
    syncBlockLines();
    syncLabels();
    const bp = play.ballPosition();
    const off = play.ball.holder ? 0.35 : 0;
    const bw = fieldToWorld(bp.x, bp.y + off);
    ball.position.set(bw.x, 0.2, bw.z);
    const sel = selectedId && play.player(selectedId);
    ring.visible = !!sel;
    if (sel) {
      const w = fieldToWorld(sel.x, sel.y);
      ring.position.set(w.x, 0.15, w.z);
    }
    updatePanel();
  }

  // ---- Interaction ----
  const el = renderer.domElement;
  const ndc = new THREE.Vector3();
  function groundAt(clientX, clientY) {
    const r = el.getBoundingClientRect();
    ndc.set(((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1, 0).unproject(camera);
    return { gx: ndc.x, gy: 50 - ndc.z };
  }
  function dotAt(clientX, clientY) {
    const { gx, gy } = groundAt(clientX, clientY);
    return pickDot(play.players, gx, gy, 0.9);
  }

  let down = null;
  el.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0 };
    el.setPointerCapture?.(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (down) {
      const dx = e.clientX - down.lx;
      const dy = e.clientY - down.ly;
      down.lx = e.clientX; down.ly = e.clientY;
      down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
      const r = el.getBoundingClientRect();
      const ux = (camera.right - camera.left) / camera.zoom / r.width;
      const uy = (camera.top - camera.bottom) / camera.zoom / r.height;
      camera.position.x -= dx * ux;
      camera.position.z -= dy * uy;
    }
    const p = dotAt(e.clientX, e.clientY);
    if (p && tooltip) {
      tooltip.textContent = `${p.id} · ${p.name}`;
      tooltip.style.display = 'block';
      tooltip.style.left = `${e.clientX + 14}px`;
      tooltip.style.top = `${e.clientY + 14}px`;
    } else if (tooltip) {
      tooltip.style.display = 'none';
    }
    el.style.cursor = p ? 'pointer' : (down ? 'grabbing' : 'default');
  });
  el.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || d.moved >= 4) return;
    const p = dotAt(e.clientX, e.clientY);
    if (p) selectedId = p.id;
    else play.snap();
  });
  el.addEventListener('pointerleave', () => { if (tooltip) tooltip.style.display = 'none'; });
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const z = camera.zoom * Math.exp(-e.deltaY * 0.001);
    camera.zoom = Math.min(6, Math.max(0.5, z));
    camera.updateProjectionMatrix();
  }, { passive: false });

  const doReset = () => { play.reset(); showShift(); showLB(); };
  resetBtn?.addEventListener('click', doReset);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { selectedId = null; return; }
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
        (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      play.shiftLB(e.key === 'ArrowRight' ? 1 : -1);
      showLB();
      return;
    }
    // Shift stays allowed so '+' (Shift+=) and '_' (Shift+-) work; ctrl/meta/alt keep browser zoom.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const step = (d) => Math.round((play.timeScale + d) * 100) / 100;
      if (e.key === '-' || e.key === '_') { play.setTimeScale(step(-0.05)); showSpeed(); return; }
      if (e.key === '=' || e.key === '+') { play.setTimeScale(step(0.05)); showSpeed(); return; }
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      play.shiftDL(e.key === 'ArrowRight' ? 1 : -1);
      showShift();
      return;
    }
    if (e.key.toLowerCase() === 'r') doReset();
  });

  // ---- Loop ----
  let last = performance.now();
  let readySet = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    play.step(dt);
    sync();
    renderer.render(scene, camera);
    if (!readySet) {
      readySet = true;
      window.__game = { ready: true, play };
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return play;
}
