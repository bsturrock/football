// Dots view layer: top-down three.js rendering of the dots play state.
// Pure helpers are exported for tests; THREE/DOM are only touched in initDotsView.

import { createPlay, FIXED_DT, SIM_SPEED, SIM_SPEED_MIN, SIM_SPEED_MAX, DL_SHIFT_STEP, LB_SHIFT_STEP } from './play.js';
import { FRONTS, PERSONNEL, FORMATIONS, DEF_PERSONNEL, BALL_LENGTH, BALL_WIDTH } from './roster.js';
import { SCRIPTS, CALLS, recogTime } from './defense.js';
import { TRACK_HALF, TRACK_DEPTH } from './perceive.js';
import { BODY_RADIUS, blockPush, engagedOn } from './blocking.js';
import { wrapAngle, angleDiff, facingDir } from './facing.js';
import { HW } from '../util.js';

// Number label square covers the dot.
export const LABEL_SIZE = 2 * BODY_RADIUS;

// Real-world field and ball scale (yards). Ball rear tip sits on the holder's front edge.
export const BALL_DRAW_AHEAD = BODY_RADIUS + BALL_LENGTH / 2;
export const HASH_HALF = 18.5 / 6; // hashes 18 ft 6 in apart, centered
export const HASH_LEN = 2 / 3; // 2 ft tick
export const YARD_LINE_W = 1 / 9; // 4 in
export const GOAL_LINE_W = 2 / 9; // 8 in
export const BORDER_W = 2; // 6 ft white border
export const UPRIGHTS_W = 18.5 / 3; // goal posts 18 ft 6 in apart
export const RING_INNER = 2.1 * BODY_RADIUS;
export const RING_OUTER = 2.7 * BODY_RADIUS;
export const OFFENSE_COLOR = 0x2f6bff, DEFENSE_COLOR = 0xe23b3b;
// Fight lines: push and drive arrows are FIGHT_ARROW yards long; net motion is NET_SCALE s of carry (yd/s).
export const FIGHT_ARROW = 1.0;
export const NET_SCALE = 0.5;

const SHIFT_STEP = Object.freeze({ DL: DL_SHIFT_STEP, LB: LB_SHIFT_STEP });

// The one matchup dots.html shows (R-26).
export const PAGE_MATCHUP = Object.freeze({ formation: '11', playside: 'left', script: null, call: null });
// true hides the matchup pickers and DL/LB shift controls; false brings them back.
export const MATCHUP_LOCKED = true;

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

// Panel text for a defender's block reaction ('' for offense; play.players carries react).
export function reactLabel(player) {
  if (player.team === 'offense') return '';
  const r = player.react;
  if (!r) return 'Reaction: none';
  return `Reaction: ${r.state} · lean ${r.lean.toFixed(2)}`;
}

// Hint text for the pre-snap D-line shift (steps: +1 = right, -1 = left).
export function shiftLabel(steps, group = 'DL', keys = '←/→') {
  if (steps === 0) return `${group} shift: even (${keys})`;
  const step = SHIFT_STEP[group] ?? DL_SHIFT_STEP;
  const yd = formatYards(Math.abs(steps) * step);
  const side = steps > 0 ? 'R' : 'L';
  return `${group} shift: ${yd} yd ${side} (${keys})`;
}

// Label for the defense-fights-blocks toggle (F key or button).
export function fightLabel(on) {
  return `Defense fights blocks: ${on ? 'on' : 'off'} (F)`;
}

// Label for the DL pass-rush moves toggle (M key or button).
export function movesLabel(on) {
  return `Moves: ${on ? 'on' : 'off'} (M)`;
}

// Hint text for the play's seed (shown on each Reset).
export function seedLabel(seed) {
  return `Seed ${seed}`;
}

// Label for the play recognition range (null = roster reads; else the rating and its read time).
export function recogLabel(v) {
  if (v === null || v === undefined) return 'Recognition: roster';
  return `Recognition: ${v} (read ${recogTime(v).toFixed(2)} s)`;
}

// Short on-field label for a defender's live pass-rush move ('' = none, or the move is at rest).
// A defender who just shed his blocker by leverage (shedFree counting down, shedHow 'leverage')
// reads 'shed'; a move-won shed (shedHow 'swim' / 'power') keeps the move text.
// A defender who just slipped a block in the open-field contest (shedHow 'shrug') reads 'shrug';
// a blocker who just bounced off a defender (block.contest 'bounce', cooling) reads 'bounce'.
export function moveLabel(p) {
  const m = p?.move;
  if (m) {
    if (m.phase === 'try') return m.kind;
    if (m.phase === 'won') return `${m.kind} won`;
    if (m.phase === 'lost') return `${m.kind} lost`;
  }
  if ((p?.shedFree ?? 0) > 0 && p.shedHow === 'leverage') return 'shed';
  if ((p?.shedFree ?? 0) > 0 && p.shedHow === 'shrug') return 'shrug';
  if (p?.block?.contest === 'bounce' && (p.block.cool ?? 0) > 0 && !p.block.engaged) return 'bounce';
  return '';
}

// Sim speed step per -/+ press (keys or buttons).
export const SPEED_STEP = 0.05;

// Next sim speed after one step (dir: +1 faster, -1 slower), rounded to 2 decimals and clamped.
export function speedStep(timeScale, dir) {
  const next = Math.round((timeScale + dir * SPEED_STEP) * 100) / 100;
  return Math.min(SIM_SPEED_MAX, Math.max(SIM_SPEED_MIN, next));
}

// Picker options for the defensive front: one per FRONTS entry, in FRONTS order.
export function frontOptions() {
  return Object.entries(FRONTS).map(([key, f]) => ({ key, name: f.name }));
}

// Picker options for offensive personnel: one per PERSONNEL entry, in PERSONNEL order.
export function personnelOptions() {
  return Object.entries(PERSONNEL).map(([key, p]) => ({ key, name: p.name }));
}

// Picker options for the full-11 offensive formation ('' = the box-only personnel pickers).
export function formationOptions() {
  return [{ key: '', name: 'Box only' },
    ...Object.entries(FORMATIONS).map(([key, f]) => ({ key, name: f.name }))];
}

// Picker options for the full-11 defence ('' = the front picker's 7-man front).
export function defPersonnelOptions() {
  return [{ key: '', name: 'Front picker' },
    ...Object.entries(DEF_PERSONNEL).map(([key, d]) => ({ key, name: d.name }))];
}

// Picker options for the defensive script ('' = none).
export function scriptOptions() {
  return [{ key: '', name: 'No script' },
    ...Object.entries(SCRIPTS).map(([key, s]) => ({ key, name: s.name }))];
}

// Picker options for the defensive call ('' = by personnel).
export function callOptions() {
  return [{ key: '', name: 'Call: by personnel' },
    ...Object.entries(CALLS).map(([key, c]) => ({ key, name: c.name }))];
}

// Picker options for the pre-snap run direction.
export function playsideOptions() {
  return [{ key: 'left', name: 'Run left' }, { key: 'right', name: 'Run right' }];
}

// Label for the read-trace overlay toggle (O key or button).
export function overlayLabel(on) {
  return `Overlay: ${on ? 'on' : 'off'} (O)`;
}

// Short on-field label for a trace decision ('' = nothing to say).
export function decisionLabel(decision) {
  if (!decision) return '';
  if (decision.kind === 'block') {
    return `${decision.tech ?? 'blk'} ${decision.target}${decision.engaged ? '*' : ''}`;
  }
  if (decision.kind === 'defend') return String(decision.state ?? '');
  if (decision.kind === 'carry') return decision.locked ? String(decision.lane) : 'read';
  return '';
}

// Tooltip lines for one trace entry: the read cues, the decision and the reason.
export function readLines(entry) {
  const r = entry?.read ?? {};
  const parts = [];
  if (r.tech) parts.push(`tech ${r.tech.label} ${r.tech.shade}`);
  if (r.track) parts.push(`track ${r.track.ids.join(',') || 'none'}`);
  if (r.lbs) {
    const s = Object.entries(r.lbs).map(([id, st]) => `${id} ${st}`).join(', ');
    if (s) parts.push(`lbs ${s}`);
  }
  if (r.felt) parts.push(`felt ${r.felt}`);
  if (r.hat) parts.push(`hat ${r.hat}`);
  if (r.flow) parts.push(`flow ${r.flow.kind} ${r.flow.dir}`);
  if (r.key) parts.push(`key ${r.key.id}`);
  return [`read: ${parts.join(' | ')}`,
    `decision: ${decisionLabel(entry?.decision)}`,
    `reason: ${entry?.reason ?? ''}`];
}

// Overlay geometry: marks and pairs from play.plan; tracks, keys and labels from the latest
// trace tick. All empty before the snap; tracks, keys and labels also empty without a trace.
// fights: one per defender with an engaged blocker (push, drive, net motion); no trace needed.
export function overlayShapes(play) {
  const out = { tracks: [], keys: [], labels: [], marks: [], pairs: [], fights: [] };
  const plan = play.plan;
  if (plan) {
    if (plan.mike) out.marks.push({ id: plan.mike, text: 'MIKE' });
    for (const [id, a] of Object.entries(plan.accounted ?? {})) {
      if (a.how === 'free' || a.how === 'read') out.marks.push({ id, text: a.how });
    }
    for (const pr of plan.pairs ?? []) out.pairs.push({ a: pr.owner, b: pr.partner, text: pr.name });
  }
  for (const d of play.players) {
    if (d.team !== 'defense') continue;
    const engaged = engagedOn(play.players, d.id);
    if (engaged.length === 0) continue;
    const push = blockPush(engaged);
    const len = Math.hypot(push.x, push.y);
    out.fights.push({
      id: d.id, x: d.x, y: d.y,
      push: len < 1e-9 ? null : { x: push.x / len, y: push.y / len },
      drive: d.react?.dir ?? null,
      net: d.carry ?? null,
      state: d.react?.state ?? 'neutral',
      n: engaged.length,
    });
  }
  const ticks = play.trace?.ticks;
  const tick = ticks && ticks[ticks.length - 1];
  if (!tick) return out;
  const ids = new Set(play.players.map((p) => p.id));
  for (const p of play.players) {
    if (p.team === 'offense' && (p.role === 'OL' || p.role === 'TE')) {
      out.tracks.push({ id: p.id, x0: p.x - TRACK_HALF, x1: p.x + TRACK_HALF, y0: p.y, y1: p.y + TRACK_DEPTH });
    }
    const entry = tick.players[p.id];
    if (!entry) continue;
    const lb = entry.read?.track?.lb;
    if (lb && ids.has(lb)) out.keys.push({ from: p.id, to: lb, kind: 'track' });
    const key = entry.read?.key;
    if (key && ids.has(key.id)) out.keys.push({ from: p.id, to: key.id, kind: 'key' });
    out.labels.push({ id: p.id, text: decisionLabel(entry.decision) });
  }
  return out;
}

// Text for a player's zone-number label ('' hides it).
export function numberLabel(n) {
  return n === null || n === undefined ? '' : String(n);
}

// Text for the RB's hole read ('' hides it; play.run may be null or undefined before the snap).
export function runLabel(run) {
  if (!run || !run.carried) return '';
  const hole = run.lane?.side === 'back' ? `${run.gap} back` : run.gap;
  return `Hole: ${hole} (${run.locked ? 'locked' : 'reading'})`;
}

// Draw position of a player: interpolated from the start of the last sim tick toward the current
// position by play.alpha (the leftover fraction of a tick). Reads play state only; no caches.
export function drawPos(play, p) {
  const prev = play.prev?.[p.id];
  if (!prev) return { x: p.x, y: p.y };
  const a = play.alpha ?? 0;
  return { x: prev.x + (p.x - prev.x) * a, y: prev.y + (p.y - prev.y) * a };
}

// Nose mark half-width (yards): a thin triangle on the dot's facing edge.
export const NOSE_HALF_W = BODY_RADIUS / 3;

// Draw facing of a player: the shortest arc from the prev facing to the current one by play.alpha.
export function drawFacing(play, p) {
  const prevF = play.prev?.[p.id]?.facing;
  if (!Number.isFinite(prevF)) return p.facing;
  const a = play.alpha ?? 0;
  return wrapAngle(prevF + angleDiff(prevF, p.facing) * a);
}

// Nose triangle [tip, left, right] in field coords: tip ahead of pos along facing, base across it.
export function noseTriangle(pos, facing) {
  const d = facingDir(facing);
  const n = { x: d.y, y: -d.x };
  return [
    { x: pos.x + d.x * BODY_RADIUS, y: pos.y + d.y * BODY_RADIUS },
    { x: pos.x + n.x * NOSE_HALF_W, y: pos.y + n.y * NOSE_HALF_W },
    { x: pos.x - n.x * NOSE_HALF_W, y: pos.y - n.y * NOSE_HALF_W },
  ];
}

// Panel text for how the play ended ('' while the play is live).
export function resultLabel(result) {
  if (!result) return '';
  const yards = result.yards;
  const yardsText = (yards >= 0 ? '+' : '') + yards.toFixed(1) + ' yd';
  if (result.reason === 'tackle') return `Tackled by ${result.by}, ${yardsText}`;
  if (result.reason === 'touchdown') return `Touchdown, ${yardsText}`;
  if (result.reason === 'out') return `Out of bounds, ${yardsText}`;
  return `Play over, ${yardsText}`;
}

// Build stamp from the last CHANGELOG.md entry: "F-4 · 2026-10-11 · 6fe1145".
export function versionLabel(text) {
  if (typeof text !== 'string') return 'version unknown';
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\s+$/, '');
    const m = line.match(/^- (\d{4}-\d{2}-\d{2}) (F-\d+) .* ([0-9a-f]{7,40})$/);
    if (m) return `${m[2]} · ${m[1]} · ${m[3]}`;
  }
  return 'version unknown';
}

// ---- Review plays (F-63 #14): the exact setup of each line-play test R-23 made report-only ----
// The 14 setup fields play.reset() and snap() read. A review entry sets all of them.
export const SETUP_FIELDS = Object.freeze([
  'front', 'personnel', 'playside', 'formation', 'defPersonnel', 'script', 'call',
  'dlShift', 'lbShift', 'moves', 'tackles', 'accel', 'fightBlocks', 'seed',
]);

// Plain copy of a play's setup fields.
export function playSetup(play) {
  const out = {};
  for (const f of SETUP_FIELDS) out[f] = play[f];
  return out;
}

// Assigns the setup fields directly (the setters each reset on their own), then resets the play.
export function applySetup(play, setup) {
  for (const f of SETUP_FIELDS) play[f] = setup[f];
  play.reset();
}

const REVIEW_SHARED = Object.freeze({
  formation: null, defPersonnel: null, script: null, call: null, lbShift: 0,
  moves: false, accel: true, fightBlocks: true, seed: 1,
});
const reviewPlay = (key, name, watch, fields) =>
  Object.freeze({ key, name, watch, setup: Object.freeze({ ...REVIEW_SHARED, ...fields }) });

export const REVIEW_PLAYS = Object.freeze([
  reviewPlay('climb-under43', 'Test: climber vs L2 (under43, TE, right)',
    'zone F-55 #6d: C climbs past L2 near tick 102 · squeeze F-55 #9: C lateral jump near tick 111',
    { front: 'under43', personnel: 'te', playside: 'right', dlShift: 0, tackles: false }),
  reviewPlay('steer-dlMinus4', 'Test: DL shifted 4 left (base)',
    'steering accel cap dlMinus4: collision rebound on a free defender',
    { front: 'base', personnel: 'te', playside: 'left', dlShift: -4, tackles: true }),
  reviewPlay('stall-bear', 'Test: RB stall (bear, no TE)',
    'accel-stall F-25 #3: RB slow in the hole',
    { front: 'bear', personnel: 'noTe', playside: 'left', dlShift: 0, tackles: false }),
  reviewPlay('slip-noTe', 'Test: RB crossing (base, no TE)',
    'play-blocking F-15 #8c: RB crossing off his lane',
    { front: 'base', personnel: 'noTe', playside: 'left', dlShift: 0, tackles: false }),
  reviewPlay('slip-te', 'Test: RB crossing (base, TE)',
    'play-blocking F-40 #7: RB crossing off his lane',
    { front: 'base', personnel: 'te', playside: 'left', dlShift: 0, tackles: false }),
  reviewPlay('stall-over43', 'Test: RB stall (over43, no TE)',
    'accel-stall F-25 #3: RB slow in the hole',
    { front: 'over43', personnel: 'noTe', playside: 'left', dlShift: 0, tackles: false }),
  reviewPlay('shed-backedOff', 'Test: shed DL closing (backedOff)',
    'zone F-33 #8: PE after his shed near 1.78 s (tick 107)',
    { front: 'backedOff', personnel: 'te', playside: 'left', dlShift: 0, tackles: false }),
  reviewPlay('squeeze-walkedUp', 'Test: RB squeeze past MIK (walkedUp, no TE)',
    'carrier F-48 #11b: RB sideways twitch squeezing past C/MIK near ticks 99 and 108 (contact, aim steady)',
    { front: 'walkedUp', personnel: 'noTe', playside: 'left', dlShift: 0, tackles: true }),
  reviewPlay('cutoff-safety', 'Test: safety cut-off (11 vs nickel, left)',
    'pursuit F-69 #1: FS and SS square up to the RB and shuffle across his path about 2.2-3.0 s, facing him, not turning to run after him',
    { front: 'base', personnel: 'te', formation: '11', defPersonnel: 'nickel', playside: 'left', dlShift: 0, tackles: true }),
  reviewPlay('chase-backside', 'Test: backside chase (11 vs nickel, left, no tackles)',
    'pursuit F-69 #2: CBZ (backside corner) runs to where the RB is going from about 1.5 s, not at his back',
    { front: 'base', personnel: 'te', formation: '11', defPersonnel: 'nickel', playside: 'left', dlShift: 0, tackles: false }),
  reviewPlay('pedal-lb-db', 'Test: LB and DB pedal (11 vs nickel, right, no tackles)',
    'strafe F-69 #10: at the snap FS, SS, CBX, CBZ and NB pedal straight back about 1.5 yd still facing the backfield; MIK and WIL slide sideways on the read step still facing the line; the backside end shuffles on his contain squeeze facing the ball',
    { front: 'base', personnel: 'te', formation: '11', defPersonnel: 'nickel', playside: 'right', dlShift: 0, tackles: false }),
]);

// Review select options: the page matchup first (key ''), then one per review play.
export function reviewOptions() {
  return [{ key: '', name: 'Page matchup' }, ...REVIEW_PLAYS.map(({ key, name }) => ({ key, name }))];
}

// Advances exactly one fixed tick: tops the accumulator up to one tick. Nothing runs before the snap or after the play is dead.
export function stepOneTick(play) {
  if (play.ball.phase === 'presnap' || play.ball.phase === 'dead') return;
  play.step(FIXED_DT * (1 - play.alpha) / play.timeScale);
}

// Readout for the tick counter: the tick and its time in seconds.
export function tickLabel(ticks) {
  return `Tick ${ticks} · ${(ticks / 60).toFixed(2)} s`;
}

export function initDotsView(container) {
  const play = createPlay(25, 'insideZone', { timeScale: SIM_SPEED, trace: true, moves: true, contest: true, ...PAGE_MATCHUP });
  const home = playSetup(play);
  const tooltip = document.getElementById('tooltip');
  const panel = document.getElementById('info-panel');
  const versionEl = document.getElementById('version');
  if (versionEl) {
    // Not awaited: the play loop must start regardless of the fetch.
    fetch('./CHANGELOG.md')
      .then((r) => (r.ok ? r.text() : ''))
      .then((text) => { versionEl.textContent = versionLabel(text); })
      .catch(() => { versionEl.textContent = 'version unknown'; });
  }
  const resetBtn = document.getElementById('reset-btn');
  const frontSelect = document.getElementById('front-select');
  const personnelSelect = document.getElementById('personnel-select');
  const hint = document.getElementById('hint');
  const speedReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  const showSpeed = () => {
    if (speedReadout) speedReadout.textContent = `Speed ${play.timeScale.toFixed(2)}x (-/+)`;
  };
  showSpeed();
  // Bar reads [−] Speed 0.35x (-/+) [+] on phones and desktop alike.
  const speedDown = document.getElementById('speed-down');
  const speedUp = document.getElementById('speed-up');
  if (speedDown && speedReadout && speedUp) {
    speedDown.after(speedReadout);
    speedReadout.after(speedUp);
  }
  const shiftReadout = hint && !MATCHUP_LOCKED ? hint.appendChild(document.createElement('span')) : null;
  const showShift = () => {
    if (shiftReadout) shiftReadout.textContent = shiftLabel(play.dlShift);
  };
  showShift();
  const lbReadout = hint && !MATCHUP_LOCKED ? hint.appendChild(document.createElement('span')) : null;
  const showLB = () => {
    if (lbReadout) lbReadout.textContent = shiftLabel(play.lbShift, 'LB', '⇧←/→');
  };
  showLB();
  const seedReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  const showSeed = () => {
    if (seedReadout) seedReadout.textContent = seedLabel(play.seed);
  };
  showSeed();
  const watchReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  const tickReadout = hint ? hint.appendChild(document.createElement('span')) : null;
  let shownTicks = null;
  const showTicks = () => {
    if (!tickReadout || shownTicks === play.ticks) return;
    shownTicks = play.ticks;
    tickReadout.textContent = tickLabel(play.ticks);
  };
  showTicks();
  // Review picker (F-63 #14): '' is the page matchup; reviewEntry is the test play loaded, or null.
  const reviewSelect = document.getElementById('review-select');
  if (reviewSelect) {
    for (const { key, name } of reviewOptions()) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = name;
      reviewSelect.appendChild(opt);
    }
    reviewSelect.value = '';
  }
  let reviewEntry = null;

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
  flat(2 * HW, 0.3, 0xffd400, 0, play.los, 0.03);

  // ---- Dots ----
  const dotMeshes = new Map();
  const geo = new THREE.CircleGeometry(BODY_RADIUS, 24);
  function dotFor(p) {
    let m = dotMeshes.get(p.id);
    if (!m) {
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: p.team === 'offense' ? OFFENSE_COLOR : DEFENSE_COLOR }));
      m.rotation.x = -Math.PI / 2;
      scene.add(m);
      dotMeshes.set(p.id, m);
    }
    return m;
  }

  // ---- Nose marks (facing triangle on each dot) ----
  const noseMeshes = new Map();
  function noseFor(id) {
    let m = noseMeshes.get(id);
    if (!m) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
      m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
      scene.add(m);
      noseMeshes.set(id, m);
    }
    return m;
  }
  function syncNoses() {
    for (const p of play.players) {
      const m = noseFor(p.id);
      const tri = noseTriangle(drawPos(play, p), drawFacing(play, p));
      const pos = m.geometry.attributes.position;
      tri.forEach((pt, i) => {
        const w = fieldToWorld(pt.x, pt.y);
        pos.setXYZ(i, w.x, 0.11, w.z);
      });
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      m.visible = true;
    }
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
  function labelFor(id) {
    let m = labels.get(id);
    if (!m) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      m = new THREE.Mesh(new THREE.PlaneGeometry(LABEL_SIZE, LABEL_SIZE),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.userData = { canvas: c, texture: tex };
      m.visible = false;
      scene.add(m);
      labels.set(id, m);
    }
    return m;
  }
  let lastNumbers = null;
  function syncLabels() {
    if (play.numbers !== lastNumbers) {
      lastNumbers = play.numbers;
      for (const p of play.players) {
        drawLabel(labelFor(p.id), numberLabel(play.numbers[p.id]));
      }
    }
    for (const p of play.players) {
      const d = drawPos(play, p);
      const w = fieldToWorld(d.x, d.y);
      labelFor(p.id).position.set(w.x, 0.13, w.z);
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
      const da = drawPos(play, p);
      const db = drawPos(play, target);
      const a = fieldToWorld(da.x, da.y);
      const b = fieldToWorld(db.x, db.y);
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

  // ---- Read-trace overlay (track strips, key lines, decision labels) ----
  let overlayOn = false;
  const TRACK_COLOR = 0x4fc3f7, KEY_COLOR = 0xff9800;
  const OV_LABEL_W = 4 * LABEL_SIZE, OV_LABEL_H = LABEL_SIZE * 0.6;
  const trackStrips = new Map();
  const keyLines = new Map();
  const decLabels = new Map();
  const markLabels = new Map();
  const pairLabels = new Map();
  function trackStripFor(id) {
    let m = trackStrips.get(id);
    if (!m) {
      m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: TRACK_COLOR, transparent: true, opacity: 0.12, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      scene.add(m);
      trackStrips.set(id, m);
    }
    return m;
  }
  function keyLineFor(name, kind) {
    let line = keyLines.get(name);
    if (!line) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: kind === 'key' ? KEY_COLOR : TRACK_COLOR, transparent: true, opacity: 0.9 }));
      line.visible = false;
      scene.add(line);
      keyLines.set(name, line);
    }
    return line;
  }
  // Fight lines: one pool per name ('<id>|push' | '<id>|drive' | '<id>|net'), hidden when unused.
  const fightLines = new Map();
  function fightLineFor(name, color) {
    let line = fightLines.get(name);
    if (!line) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }));
      line.visible = false;
      scene.add(line);
      fightLines.set(name, line);
    }
    return line;
  }
  // One text sprite per key in its own map (decision labels, marks and pair labels never share one).
  function spriteFor(map, key) {
    let m = map.get(key);
    if (!m) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 64;
      const tex = new THREE.CanvasTexture(c);
      m = new THREE.Mesh(new THREE.PlaneGeometry(OV_LABEL_W, OV_LABEL_H),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.userData = { canvas: c, texture: tex, text: null };
      m.visible = false;
      scene.add(m);
      map.set(key, m);
    }
    return m;
  }
  function decLabelFor(id) { return spriteFor(decLabels, id); }
  function paintLabel(m, text) {
    if (m.userData.text === text) return;
    m.userData.text = text;
    const c = m.userData.canvas;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.font = 'bold 36px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 7;
    g.strokeStyle = '#000';
    g.lineJoin = 'round';
    g.strokeText(text, c.width / 2, c.height / 2);
    g.fillStyle = '#fff';
    g.fillText(text, c.width / 2, c.height / 2);
    m.userData.texture.needsUpdate = true;
  }
  function syncOverlay() {
    const shapes = overlayOn ? overlayShapes(play)
      : { tracks: [], keys: [], labels: [], marks: [], pairs: [], fights: [] };
    const usedTracks = new Set(), usedKeys = new Set(), usedLabels = new Set();
    const usedMarks = new Set(), usedPairs = new Set(), usedFights = new Set();
    for (const f of shapes.fights) {
      const from = fieldToWorld(f.x, f.y);
      const arrows = [['push', f.push, OFFENSE_COLOR, FIGHT_ARROW], ['drive', f.drive, DEFENSE_COLOR, FIGHT_ARROW],
        ['net', f.net, 0xffffff, NET_SCALE]];
      for (const [kind, v, color, scale] of arrows) {
        if (!v) continue;
        const name = `${f.id}|${kind}`;
        const line = fightLineFor(name, color);
        const to = fieldToWorld(f.x + v.x * scale, f.y + v.y * scale);
        const pos = line.geometry.attributes.position;
        pos.setXYZ(0, from.x, 0.15, from.z);
        pos.setXYZ(1, to.x, 0.15, to.z);
        pos.needsUpdate = true;
        line.visible = true;
        usedFights.add(name);
      }
    }
    for (const t of shapes.tracks) {
      const p = play.player(t.id);
      if (!p) continue;
      const d = drawPos(play, p);
      const m = trackStripFor(t.id);
      const w = fieldToWorld((t.x0 + t.x1) / 2 + (d.x - p.x), (t.y0 + t.y1) / 2 + (d.y - p.y));
      m.position.set(w.x, 0.05, w.z);
      m.scale.set(t.x1 - t.x0, t.y1 - t.y0, 1);
      m.visible = true;
      usedTracks.add(t.id);
    }
    for (const k of shapes.keys) {
      const a = play.player(k.from), b = play.player(k.to);
      if (!a || !b) continue;
      const name = `${k.from}|${k.kind}`;
      const line = keyLineFor(name, k.kind);
      const da = drawPos(play, a), db = drawPos(play, b);
      const wa = fieldToWorld(da.x, da.y), wb = fieldToWorld(db.x, db.y);
      const pos = line.geometry.attributes.position;
      pos.setXYZ(0, wa.x, 0.14, wa.z);
      pos.setXYZ(1, wb.x, 0.14, wb.z);
      pos.needsUpdate = true;
      line.visible = true;
      usedKeys.add(name);
    }
    for (const l of shapes.labels) {
      const p = play.player(l.id);
      if (!p || l.text === '') continue;
      const m = decLabelFor(l.id);
      paintLabel(m, l.text);
      const d = drawPos(play, p);
      const w = fieldToWorld(d.x, d.y - BODY_RADIUS - OV_LABEL_H / 2);
      m.position.set(w.x, 0.16, w.z);
      m.visible = true;
      usedLabels.add(l.id);
    }
    // Marks sit just above (downfield of) their defender, away from the decision label below it.
    for (const mk of shapes.marks) {
      const p = play.player(mk.id);
      if (!p) continue;
      const key = `${mk.id}|${mk.text}`;
      const m = spriteFor(markLabels, key);
      paintLabel(m, mk.text);
      const d = drawPos(play, p);
      const w = fieldToWorld(d.x, d.y + BODY_RADIUS + OV_LABEL_H / 2);
      m.position.set(w.x, 0.16, w.z);
      m.visible = true;
      usedMarks.add(key);
    }
    // Pair labels sit at the midpoint of the two linemen, slightly behind them (toward the backfield).
    for (const pr of shapes.pairs) {
      const a = play.player(pr.a), b = play.player(pr.b);
      if (!a || !b) continue;
      const key = `${pr.a}|${pr.b}|${pr.text}`;
      const m = spriteFor(pairLabels, key);
      paintLabel(m, pr.text);
      const da = drawPos(play, a), db = drawPos(play, b);
      const w = fieldToWorld((da.x + db.x) / 2, (da.y + db.y) / 2 - BODY_RADIUS - OV_LABEL_H / 2);
      m.position.set(w.x, 0.16, w.z);
      m.visible = true;
      usedPairs.add(key);
    }
    for (const [id, m] of trackStrips) if (!usedTracks.has(id)) m.visible = false;
    for (const [name, m] of keyLines) if (!usedKeys.has(name)) m.visible = false;
    for (const [id, m] of decLabels) if (!usedLabels.has(id)) m.visible = false;
    for (const [key, m] of markLabels) if (!usedMarks.has(key)) m.visible = false;
    for (const [key, m] of pairLabels) if (!usedPairs.has(key)) m.visible = false;
    for (const [name, line] of fightLines) if (!usedFights.has(name)) line.visible = false;
  }

  // ---- DL move labels (shown whether the overlay is on or off) ----
  // Sits under the decision label, toward the offense, so the two never overlap.
  const moveLabels = new Map();
  function syncMoveLabels() {
    const used = new Set();
    for (const p of play.players) {
      const text = moveLabel(p);
      if (text === '') continue;
      const m = spriteFor(moveLabels, p.id);
      paintLabel(m, text);
      const d = drawPos(play, p);
      const w = fieldToWorld(d.x, d.y - BODY_RADIUS - OV_LABEL_H * 1.5);
      m.position.set(w.x, 0.16, w.z);
      m.visible = true;
      used.add(p.id);
    }
    for (const [id, m] of moveLabels) if (!used.has(id)) m.visible = false;
  }

  // ---- Ball marker ----
  // Unit circles scaled to the ball's width (x) and length (y) before the -PI/2 x turn, so length runs along z.
  const ball = new THREE.Group();
  const outline = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const fill = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x8b4513 }));
  outline.scale.set(BALL_WIDTH + 0.06, BALL_LENGTH + 0.06, 1);
  fill.scale.set(BALL_WIDTH, BALL_LENGTH, 1);
  outline.rotation.x = fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.01;
  ball.add(outline, fill);
  scene.add(ball);

  // ---- Selection ring ----
  const ring = new THREE.Mesh(new THREE.RingGeometry(RING_INNER, RING_OUTER, 32),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  let selectedId = null;

  function ballStatus() {
    const b = play.ball;
    if (b.phase === 'presnap') return `Ball: ${b.holder} (pre-snap)`;
    if (b.phase === 'snapping') return 'Ball: snapping…';
    if (b.phase === 'dead') return 'Ball: dead';
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
        (reactLabel(sel) ? `<div>${reactLabel(sel)}</div>` : '') +
        `<div>${has ? 'Has the ball' : 'Does not have the ball'}</div>`;
    } else {
      html += '<div>Click a dot to select</div>';
    }
    html += `<div style="margin-top:6px">${ballStatus()}</div>`;
    const rl = runLabel(play.run); if (rl) html += `<div>${rl}</div>`;
    const res = resultLabel(play.result); if (res) html += `<div><b>${res}</b></div>`;
    if (html !== lastPanel) { panel.innerHTML = html; lastPanel = html; }
  }

  function sync() {
    // Meshes follow the current ids (a front change swaps defenders); ids no longer in play are hidden.
    const current = new Set(play.players.map((p) => p.id));
    for (const p of play.players) {
      const m = dotFor(p);
      m.visible = true;
      const d = drawPos(play, p);
      const w = fieldToWorld(d.x, d.y);
      m.position.set(w.x, 0.1, w.z);
    }
    for (const [id, m] of dotMeshes) if (!current.has(id)) m.visible = false;
    for (const [id, m] of labels) if (!current.has(id)) m.visible = false;
    for (const [id, line] of blockLines) if (!current.has(id)) line.visible = false;
    for (const [id, m] of noseMeshes) if (!current.has(id)) m.visible = false;
    syncBlockLines();
    syncNoses();
    syncLabels();
    syncOverlay();
    syncMoveLabels();
    const holder = play.ball.holder && play.player(play.ball.holder);
    let bw;
    if (holder) {
      const d = drawPos(play, holder);
      bw = fieldToWorld(d.x, d.y + BALL_DRAW_AHEAD);
    } else {
      const bp = play.ballPosition();
      bw = fieldToWorld(bp.x, bp.y);
    }
    ball.position.set(bw.x, 0.2, bw.z);
    const sel = selectedId && play.player(selectedId);
    ring.visible = !!sel;
    if (sel) {
      const d = drawPos(play, sel);
      const w = fieldToWorld(d.x, d.y);
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
      const ticks = play.trace?.ticks;
      const entry = ticks?.length ? ticks[ticks.length - 1].players[p.id] : null;
      tooltip.textContent = [`${p.id} · ${p.name}`, ...(entry ? readLines(entry) : [])].join('\n');
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

  const fightBtn = document.getElementById('fight-btn');
  const showFight = () => {
    if (fightBtn) fightBtn.textContent = fightLabel(play.fightBlocks);
  };
  showFight();
  const toggleFight = () => {
    play.fightBlocks = !play.fightBlocks;
    showFight();
  };
  fightBtn?.addEventListener('click', () => {
    toggleFight();
    fightBtn.blur();
  });

  const movesBtn = document.getElementById('moves-btn');
  const showMoves = () => {
    if (movesBtn) movesBtn.textContent = movesLabel(play.moves);
  };
  showMoves();
  const toggleMoves = () => {
    play.moves = !play.moves;
    showMoves();
  };
  movesBtn?.addEventListener('click', () => {
    toggleMoves();
    movesBtn.blur();
  });

  // Recognition range (0 = roster reads, 1-99 = rate every defender). Mouse and touch via a plain range input.
  const recogRange = document.getElementById('recog-range');
  const recogText = document.getElementById('recog-label');
  const showRecog = () => {
    if (recogText) recogText.textContent = recogLabel(play.recog);
    if (recogRange) recogRange.value = String(play.recog ?? 0);
  };
  showRecog();
  recogRange?.addEventListener('input', () => {
    const v = Number(recogRange.value);
    play.setRecog(v === 0 ? null : v);
    showRecog();
  });
  recogRange?.addEventListener('change', () => recogRange.blur()); // so the -, =, R, M keys keep working

  const doReset = () => {
    // A review play replays its own setup (seed 1, so the same tick by tick); the page matchup bumps the seed.
    if (reviewEntry) applySetup(play, reviewEntry.setup);
    else { play.seed += 1; play.reset(); }
    showShift(); showLB(); showFight(); showMoves(); showSeed(); showRecog();
  };
  resetBtn?.addEventListener('click', doReset);
  // Buttons sit outside #field, so no pointer handlers here; blur keeps the -/= keys working.
  const speedBtn = (btn, dir) => {
    btn?.addEventListener('click', () => {
      play.setTimeScale(speedStep(play.timeScale, dir));
      showSpeed();
      btn.blur();
    });
  };
  speedBtn(speedDown, -1);
  speedBtn(speedUp, 1);
  if (frontSelect) {
    for (const { key, name } of frontOptions()) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = name;
      frontSelect.appendChild(opt);
    }
    frontSelect.value = play.front;
    frontSelect.addEventListener('change', () => {
      play.reset();
      play.setFront(frontSelect.value);
      if (selectedId && !play.player(selectedId)) selectedId = null;
      showShift();
      showLB();
      showFight();
      frontSelect.blur(); // so ArrowLeft/ArrowRight go back to the DL shift
    });
  }
  if (personnelSelect) {
    for (const { key, name } of personnelOptions()) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = name;
      personnelSelect.appendChild(opt);
    }
    personnelSelect.value = play.personnel;
    personnelSelect.addEventListener('change', () => {
      play.reset();
      play.setPersonnel(personnelSelect.value);
      if (selectedId && !play.player(selectedId)) selectedId = null;
      showShift();
      showLB();
      showFight();
      personnelSelect.blur(); // so ArrowLeft/ArrowRight go back to the DL shift
    });
  }
  const overlayBtn = document.getElementById('overlay-btn');
  const showOverlay = () => {
    if (overlayBtn) overlayBtn.textContent = overlayLabel(overlayOn);
  };
  showOverlay();
  const toggleOverlay = () => { overlayOn = !overlayOn; showOverlay(); };
  overlayBtn?.addEventListener('click', () => {
    toggleOverlay();
    overlayBtn.blur();
  });

  const formationSelect = document.getElementById('formation-select');
  const defenseSelect = document.getElementById('defense-select');
  const scriptSelect = document.getElementById('script-select');
  const callSelect = document.getElementById('call-select');
  const playsideSelect = document.getElementById('playside-select');
  const syncPickers = () => {
    if (frontSelect) frontSelect.value = play.front;
    if (playsideSelect) playsideSelect.value = play.playside ?? '';
    if (personnelSelect) personnelSelect.value = play.personnel;
    if (formationSelect) formationSelect.value = play.formation ?? '';
    if (defenseSelect) defenseSelect.value = play.defPersonnel ?? '';
    if (scriptSelect) scriptSelect.value = play.script ?? '';
    if (callSelect) callSelect.value = play.call ?? '';
  };
  const wirePicker = (select, options, apply) => {
    if (!select) return;
    for (const { key, name } of options) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = name;
      select.appendChild(opt);
    }
    syncPickers();
    select.addEventListener('change', () => {
      apply(select.value === '' ? null : select.value);
      if (selectedId && !play.player(selectedId)) selectedId = null;
      showShift();
      showLB();
      showFight();
      select.blur();
      syncPickers();
    });
  };
  wirePicker(playsideSelect, playsideOptions(), (k) => play.setPlayside(k));
  wirePicker(formationSelect, formationOptions(), (k) => play.setFormation(k));
  wirePicker(defenseSelect, defPersonnelOptions(), (k) => play.setDefPersonnel(k));
  wirePicker(scriptSelect, scriptOptions(), (k) => play.setScript(k));
  wirePicker(callSelect, callOptions(), (k) => play.setCall(k));
  frontSelect?.addEventListener('change', () => { if (defenseSelect) defenseSelect.value = play.defPersonnel ?? ''; });
  if (MATCHUP_LOCKED) {
    // Wiring stays in place above; the locked page only hides the pickers.
    for (const s of [frontSelect, playsideSelect, personnelSelect, formationSelect, defenseSelect, scriptSelect, callSelect]) {
      if (s) s.hidden = true;
    }
  }

  // Review picker change: load the chosen test's setup, or the page matchup for ''. Tapping the field still snaps.
  reviewSelect?.addEventListener('change', () => {
    const entry = REVIEW_PLAYS.find((r) => r.key === reviewSelect.value);
    reviewEntry = entry ?? null;
    applySetup(play, entry ? entry.setup : home);
    if (selectedId && !play.player(selectedId)) selectedId = null;
    if (watchReadout) watchReadout.textContent = reviewEntry ? reviewEntry.watch : '';
    showShift(); showLB(); showFight(); showMoves(); showSeed(); showRecog();
    syncPickers();
    reviewSelect.blur();
  });

  // Pause (P) stops the sim clock; the view keeps drawing, so pan, zoom and tap-to-select still work.
  // Step (.) walks one tick, only while paused.
  let paused = false;
  const pauseBtn = document.getElementById('pause-btn');
  const showPause = () => {
    if (pauseBtn) pauseBtn.textContent = paused ? 'Play (P)' : 'Pause (P)';
  };
  showPause();
  const togglePause = () => { paused = !paused; showPause(); };
  pauseBtn?.addEventListener('click', () => {
    togglePause();
    pauseBtn.blur();
  });
  const stepBtn = document.getElementById('step-btn');
  const stepTick = () => { if (paused) stepOneTick(play); };
  stepBtn?.addEventListener('click', () => {
    stepTick();
    stepBtn.blur();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { selectedId = null; return; }
    if (!MATCHUP_LOCKED && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
        (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      play.shiftLB(e.key === 'ArrowRight' ? 1 : -1);
      showLB();
      return;
    }
    // Shift stays allowed so '+' (Shift+=) and '_' (Shift+-) work; ctrl/meta/alt keep browser zoom.
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === '-' || e.key === '_') { play.setTimeScale(speedStep(play.timeScale, -1)); showSpeed(); return; }
      if (e.key === '=' || e.key === '+') { play.setTimeScale(speedStep(play.timeScale, 1)); showSpeed(); return; }
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (!MATCHUP_LOCKED && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      play.shiftDL(e.key === 'ArrowRight' ? 1 : -1);
      showShift();
      return;
    }
    if (e.key.toLowerCase() === 'r') doReset();
    if (e.key.toLowerCase() === 'f') { toggleFight(); return; }
    if (e.key.toLowerCase() === 'm') { toggleMoves(); return; }
    if (e.key.toLowerCase() === 'p') { togglePause(); return; }
    if (e.key === '.') { stepTick(); return; }
    if (e.key.toLowerCase() === 'o' && document.activeElement?.tagName !== 'SELECT') toggleOverlay();
  });

  // ---- Loop ----
  let last = performance.now();
  let readySet = false;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) play.step(dt);
    sync();
    showTicks();
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
