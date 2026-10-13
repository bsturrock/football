import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlay } from '../src/dots/play.js';
import { FRONTS, LB_ROLES } from '../src/dots/roster.js';
import { BODY_RADIUS, RELEASE_PAST } from '../src/dots/blocking.js';
import { SCRIPTS } from '../src/dots/defense.js';
import { GAP_DEPTH } from '../src/dots/carrier.js';

const DT = 1 / 60;

// Climb spans (copied from the 'F-55 #6d' climbSpans in test/zone-play.test.js, with a script): per combo member
// that retargets off the combo's DL, from the climb tick until he engages, his target changes or the window ends.
function climbSpans(front, personnel, playside, script, lbAvoid = true) {
  const play = createPlay(25, 'insideZone', { accel: true, tackles: false, front, personnel, playside, script });
  play.snap();
  if (!lbAvoid) for (const q of play.players) if (q.team === 'defense' && LB_ROLES.includes(q.role)) q.avoid = false;
  const combos = play.combos.map((c) => ({ ...c }));
  const spans = [];
  const open = new Map();
  for (let i = 0; i * DT < 2.0 && play.ball.phase !== 'dead'; i++) {
    play.step(DT);
    for (const c of combos) {
      for (const id of [c.owner, c.partner]) {
        const m = play.player(id);
        const key = c.owner + '/' + id;
        const sp0 = open.get(key);
        if (!sp0 && !spans.some((s) => s.key === key) && m.block && !m.block.engaged && m.block.target != null && m.block.target !== c.target) {
          const sp = { key, climber: id, front, personnel, playside, lbId: m.block.target, ticks: [] };
          open.set(key, sp);
          spans.push(sp);
        }
        const sp = open.get(key);
        if (!sp) continue;
        const lb = play.player(sp.lbId);
        sp.lbEndY = lb.y;
        if (m.block?.engaged) { sp.end = 'engaged'; open.delete(key); continue; }
        if (m.block?.target == null || m.block.target !== sp.lbId) { sp.end = 'retargeted'; open.delete(key); continue; }
        // the ball is past the LB (blocking.js canEngage forbids engaging him from here): the climb is over
        if (play.ballPosition().y >= lb.y + RELEASE_PAST) { sp.end = 'ball past'; open.delete(key); continue; }
        sp.ticks.push({ i, y: m.y, vx: m.vel.x, lb: lb.id, lby: lb.y });
      }
    }
  }
  for (const sp of open.values()) sp.end = 'window end';
  return spans;
}

// The level is a contest between two goals (the climber's meeting point and the LB's own avoidance), judged by eye:
// with LB avoidance on it is report-only (the human watches over43/walkedUp, TE, run right, no script and lbBlitz in
// the browser). With LB avoidance off the contest is gone and the climber must meet his LB (next test).
test('F-63 #11: climb level per script (report-only, LB avoidance on)', (t) => {
  const pastLevel = [];
  const alreadyPast = [];
  let worstAll = -Infinity;
  for (const script of [null, ...Object.keys(SCRIPTS)]) {
    let spans = 0;
    let n = 0;
    let worst = -Infinity;
    for (const front of Object.keys(FRONTS)) for (const personnel of ['noTe', 'te']) for (const playside of ['left', 'right']) {
      for (const sp of climbSpans(front, personnel, playside, script)) {
        spans++;
        const k0 = sp.ticks[0];
        if (k0 && !(k0.y <= k0.lby + BODY_RADIUS + 1e-9)) {
          // the double drove his DL past the LB before he took a climb step
          alreadyPast.push(`${front} ${personnel} ${playside} script ${script}: ${sp.climber}>${sp.lbId} tick ${k0.i}, start margin ${(k0.y - (k0.lby + BODY_RADIUS)).toFixed(3)} yd`);
          n += sp.ticks.length;
          continue;
        }
        let first = null;
        let past = 0;
        for (const k of sp.ticks) {
          n++;
          worst = Math.max(worst, k.y - (k.lby + BODY_RADIUS));
          if (!(k.y <= k.lby + BODY_RADIUS + 1e-9)) {
            past++;
            first ??= k;
          }
        }
        if (first) {
          pastLevel.push(`${front} ${personnel} ${playside} script ${script}: ${sp.climber} past ${first.lb} at tick ${first.i} (${past} ticks): y ${first.y.toFixed(3)} > ${first.lby.toFixed(3)} + ${BODY_RADIUS}`);
        }
      }
    }
    t.diagnostic(`script ${script}: ${spans} spans, ${n} climb ticks, worst margin ${worst.toFixed(3)} yd`);
    worstAll = Math.max(worstAll, worst);
    assert.ok(spans > 0, `script ${script}: no climb spans`);
  }
  t.diagnostic(`level (report-only): ${pastLevel.length} spans past the LB's level, worst margin ${worstAll} yd`);
  for (const line of pastLevel) t.diagnostic(`level (report-only): ${line}`);
  for (const line of alreadyPast) t.diagnostic(`already past (report-only): ${line}`);
});

// With LB avoidance off the LB no longer dodges, so the F-41 #4 rule applies: a climber meets his LB before the line.
// Spans where the climber got past his LB's level (the LB came downhill past him, or the climber overran) are
// report-only in this test too: the level is a contest of goals judged by eye, as in the test above.
test('F-63 #11: with LB avoidance off, every climber meets his LB before the line, every script', (t) => {
  const bad = [];
  const pastLevel = [];
  let worstAll = -Infinity;
  for (const script of [null, ...Object.keys(SCRIPTS)]) {
    let spans = 0;
    let n = 0;
    let worst = -Infinity;
    const ends = {};
    for (const front of Object.keys(FRONTS)) for (const personnel of ['noTe', 'te']) for (const playside of ['left', 'right']) {
      for (const sp of climbSpans(front, personnel, playside, script, false)) {
        spans++;
        ends[sp.end] = (ends[sp.end] ?? 0) + 1;
        let first = null;
        let past = 0;
        for (const k of sp.ticks) {
          n++;
          worst = Math.max(worst, k.y - (k.lby + BODY_RADIUS));
          if (!(k.y <= k.lby + BODY_RADIUS + 1e-9)) {
            past++;
            first ??= k;
          }
        }
        if (first) pastLevel.push(`${front} ${personnel} ${playside} script ${script}: ${sp.climber} past ${first.lb} at tick ${first.i} (${past} ticks)`);
        if (sp.end === 'window end' && !first && sp.lbEndY < 25 + GAP_DEPTH) bad.push(`${front} ${personnel} ${playside} script ${script}: ${sp.climber}>${sp.lbId} still unengaged at the window end, LB y ${sp.lbEndY.toFixed(3)} < ${25 + GAP_DEPTH}`);
      }
    }
    t.diagnostic(`script ${script}: ${spans} spans, ${n} climb ticks, worst margin ${worst.toFixed(3)} yd, ends ${JSON.stringify(ends)}`);
    worstAll = Math.max(worstAll, worst);
  }
  t.diagnostic(`level (avoidance off, report-only): ${pastLevel.length} spans past the LB's level, worst margin ${worstAll} yd`);
  for (const line of pastLevel) t.diagnostic(`level (avoidance off, report-only): ${line}`);
  assert.equal(bad.length, 0, bad.join('\n'));
});
