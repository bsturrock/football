import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlay, FIXED_DT } from '../src/dots/play.js';
import { FORMATIONS, DEF_PERSONNEL } from '../src/dots/roster.js';
import { SCRIPTS } from '../src/dots/defense.js';
import { TRACK_HALF } from '../src/dots/perceive.js';
import {
  overlayShapes, decisionLabel, readLines, overlayLabel,
  formationOptions, defPersonnelOptions, scriptOptions,
} from '../src/dots/view.js';

function run(opts, secs = 1) {
  const play = createPlay(25, 'insideZone', { trace: true, ...opts });
  play.snap();
  for (let i = 0; i < Math.round(secs / FIXED_DT); i++) play.step(FIXED_DT);
  return play;
}

test('before the snap overlayShapes is empty', () => {
  const play = createPlay(25, 'insideZone', { trace: true });
  const s = overlayShapes(play);
  assert.deepEqual(s, { tracks: [], keys: [], labels: [] });
});

test('after the snap on the base front', () => {
  const play = run({});
  const s = overlayShapes(play);
  assert.equal(s.tracks.length, 6);
  for (const t of s.tracks) assert.ok(Math.abs(t.x1 - t.x0 - 2 * TRACK_HALF) < 1e-9);
  const ids = new Set(play.players.map((p) => p.id));
  for (const k of s.keys) {
    assert.ok(ids.has(k.from) && ids.has(k.to));
    assert.ok(k.kind === 'track' || k.kind === 'key');
  }
  assert.equal(s.labels.length, play.players.length);
  const rb = play.players.find((p) => p.role === 'RB');
  assert.notEqual(s.labels.find((l) => l.id === rb.id).text, '');
});

test('formation 11 keeps six tracks, 22 labels, blank WR labels', () => {
  const play = run({ formation: '11' });
  const s = overlayShapes(play);
  assert.equal(s.tracks.length, 6);
  assert.equal(s.labels.length, 22);
  const wrs = play.players.filter((p) => p.role === 'WR');
  assert.ok(wrs.length > 0);
  for (const w of wrs) assert.equal(s.labels.find((l) => l.id === w.id).text, '');
});

test('decisionLabel covers each kind', () => {
  assert.equal(decisionLabel({ kind: 'block', target: 'D1', tech: '3', engaged: true }), '3 D1*');
  assert.equal(decisionLabel({ kind: 'block', target: 'D1', tech: null, engaged: false }), 'blk D1');
  assert.equal(decisionLabel({ kind: 'defend', behavior: 'x', state: 'fill' }), 'fill');
  assert.equal(decisionLabel({ kind: 'carry', lane: 'A', locked: true }), 'A');
  assert.equal(decisionLabel({ kind: 'carry', lane: 'A', locked: false }), 'read');
  assert.equal(decisionLabel({ kind: 'none' }), '');
});

test('readLines has decision and reason lines', () => {
  const play = run({});
  const tick = play.trace.ticks[play.trace.ticks.length - 1];
  const id = Object.keys(tick.players)[0];
  const lines = readLines(tick.players[id]);
  assert.ok(lines.some((l) => l.startsWith('read:')));
  assert.ok(lines.some((l) => l.startsWith('decision:')));
  assert.ok(lines.some((l) => l.startsWith('reason:')));
});

test('overlayLabel states', () => {
  assert.equal(overlayLabel(true), 'Overlay: on (O)');
  assert.equal(overlayLabel(false), 'Overlay: off (O)');
});

test('option helpers', () => {
  const f = formationOptions(), d = defPersonnelOptions(), s = scriptOptions();
  assert.equal(f.length, Object.keys(FORMATIONS).length + 1);
  assert.equal(d.length, Object.keys(DEF_PERSONNEL).length + 1);
  assert.equal(s.length, Object.keys(SCRIPTS).length + 1);
  for (const o of [f, d, s]) assert.equal(o[0].key, '');
});

test('dots.html has the new controls inside #hint', () => {
  const html = readFileSync(new URL('../dots.html', import.meta.url), 'utf8');
  const hint = html.slice(html.indexOf('<div id="hint"'), html.indexOf('</div>', html.indexOf('<div id="hint"')));
  for (const id of ['overlay-btn', 'formation-select', 'defense-select', 'script-select']) {
    assert.ok(hint.includes(`id="${id}"`), id);
  }
});
