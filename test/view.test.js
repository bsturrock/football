import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fieldToWorld, pickDot } from '../src/dots/view.js';
import { createPlay } from '../src/dots/play.js';

const players = () => createPlay(25).players;
const get = (ps, id) => ps.find((p) => p.id === id);

test('fieldToWorld maps game to world', () => {
  assert.deepEqual(fieldToWorld(3, 25), { x: 3, z: 25 });
});

test('pickDot returns the dot at a spot', () => {
  const ps = players();
  const c = get(ps, 'C');
  assert.equal(pickDot(ps, c.x, c.y, 0.9).id, 'C');
});

test('pickDot between two dots returns the nearer', () => {
  const ps = players();
  const qb = get(ps, 'QB'), rb = get(ps, 'RB');
  const nearQb = pickDot(ps, qb.x * 0.7 + rb.x * 0.3, qb.y * 0.7 + rb.y * 0.3, 10);
  assert.equal(nearQb.id, 'QB');
  const nearRb = pickDot(ps, qb.x * 0.3 + rb.x * 0.7, qb.y * 0.3 + rb.y * 0.7, 10);
  assert.equal(nearRb.id, 'RB');
});

test('pickDot far from everyone returns null', () => {
  assert.equal(pickDot(players(), 500, 500, 0.9), null);
});

test('pickDot radius boundary', () => {
  const ps = players();
  const c = get(ps, 'C');
  assert.equal(pickDot(ps, c.x + 0.5, c.y, 0.5)?.id, 'C');
  assert.equal(pickDot(ps, c.x + 0.5, c.y, 0.49), null);
});
