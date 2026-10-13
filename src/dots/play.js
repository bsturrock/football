// Dots play state: lineup positions and ball possession. Pure: no THREE, no DOM.
// Ball phases: presnap -> snapping -> held -> carried -> dead (carried and dead only on plays with a run).
// Time advances only through step(dt); there are no timers or clocks here.

import { DEF_PERSONNEL, FORMATIONS, FRONTS, POSITIONS, PERSONNEL, PLAYS, TE_LOOKS, buildLineup } from './roster.js';
import { PLAYSIDE_SIGN, numberPlay } from './numbering.js';
import { boxCount, createPerception, cuesFor, observe, worldSnapshot } from './perceive.js';
import { createTrace, entriesOf, recordTick } from './trace.js';
import { startRun, stepCarrier } from './carrier.js';
import { zonePlan, zoneSwitch } from './zone.js';
import { readFront } from './front.js';
import { ACCEL_TAU } from './steering.js';
import { playEnd } from './tackle.js';
import { initFacing, stepFacing } from './facing.js';
import { CALLS, SCRIPTS, callFor, startDefense, stepDefense } from './defense.js';
import {
  BODY_RADIUS,
  assignBlocks,
  clearBlock,
  doubleTeamPeel,
  engagedOn,
  isBlocker,
  setBlock,
  stepBlocking,
} from './blocking.js';

export const SNAP_DURATION = 0.25; // seconds; quick shotgun snap, ball C to QB at roughly 18 yd/s
export const FIXED_DT = 1 / 60; // sim seconds per tick
export const MAX_SUBSTEP = FIXED_DT; // max sim seconds per stepBlocking call
export const MAX_TICKS_PER_STEP = 30; // runaway-frame guard: 0.5 s of sim per step call
export const SIM_SPEED = 0.35; // dots page default time scale
export const SIM_SPEED_MIN = 0.1;
export const SIM_SPEED_MAX = 2;
export const DL_SHIFT_STEP = BODY_RADIUS; // yards per pre-snap D-line shift step
export const DL_SHIFT_MAX = 4; // steps allowed each way
export const LB_SHIFT_STEP = BODY_RADIUS; // yards per pre-snap linebacker shift step
export const LB_SHIFT_MAX = 6; // steps allowed each way

// A scheme's plan returns {side, blocks, techs, combos, free, front}.
const SCHEMES = Object.freeze({ zone: Object.freeze({ plan: zonePlan, rule: zoneSwitch }) });

// formation: a FORMATIONS key (full-11 offense), or null. defPersonnel: a DEF_PERSONNEL key, or null
// for the FRONTS defense. Left undefined, it takes the formation's default defense, unless the caller passed front.
// call: a CALLS key, or null for the default call by defensive personnel (callFor).
// Roster RB dx (1.6), mirrored by rbAway.
const RB_DX = Math.abs(POSITIONS.find((p) => p.id === 'RB').dx);

export function createPlay(los = 25, playKey = 'base', { timeScale = 1, front, personnel = undefined, accel = true, tackles = true, fightBlocks = true, seed = 1, moves = false, contest = false, formation = null, defPersonnel = undefined, script = null, call = null, trace = false, playside = undefined, recog = null, teLook = null, rbAway = false } = {}) {
  const sideKey = playside === undefined ? PLAYS[playKey].playside ?? null : playside;
  if (sideKey !== null && !Object.hasOwn(PLAYSIDE_SIGN, sideKey)) throw new Error(`createPlay: bad playside ${playside}`);
  if (teLook !== null && !Object.hasOwn(TE_LOOKS, teLook)) throw new Error(`createPlay: bad teLook ${teLook}`);
  if (call !== null && !Object.hasOwn(CALLS, call)) throw new Error(`createPlay: unknown call "${call}"`);
  if (recog !== null && !(Number.isInteger(recog) && recog >= 1 && recog <= 99)) throw new Error(`createPlay: bad recog ${recog}`);
  const scheme = SCHEMES[PLAYS[playKey].scheme] || null;
  const defP = defPersonnel !== undefined ? defPersonnel : (front === undefined ? FORMATIONS[formation]?.defense ?? null : null);
  const play = {
    los,
    playKey,
    players: [],
    ball: {},
    retargetRule: scheme ? scheme.rule : doubleTeamPeel,
    timeScale,
    front: front ?? 'base',
    personnel: personnel ?? PLAYS[playKey].personnel ?? 'noTe',
    formation,
    defPersonnel: defP,
    script,
    call,
    accel,
    tackles,
    // off = defenders never win leverage or shed; blocks still release 'past' and 'lost'.
    fightBlocks,
    seed,
    moves,
    contest,
    dlShift: 0,
    lbShift: 0,
    numbers: {},
    combos: [],
    plan: null,
    playside: sideKey,
    recog,
    teLook,
    rbAway,
    pull: null,
    run: null,
    defense: null,
    ticks: 0,
    trace: null,
    perception: null,
    box: null,
    result: null,
    alpha: 0,
    prev: {},
  };
  let ctx = { seq: 0 };
  let acc = 0;
  const snapshotPrev = () => {
    play.prev = {};
    for (const p of play.players) play.prev[p.id] = { x: p.x, y: p.y, facing: p.facing };
  };

  play.player = (id) => play.players.find((p) => p.id === id);

  // Pre-snap D-line shift in steps. Only changes while the ball is presnap.
  play.shiftDL = (dir) => {
    if (play.ball.phase !== 'presnap') return false;
    if (dir !== 1 && dir !== -1) return play.dlShift;
    play.dlShift = Math.min(DL_SHIFT_MAX, Math.max(-DL_SHIFT_MAX, play.dlShift + dir));
    play.reset();
    return play.dlShift;
  };

  // Pre-snap linebacker shift in steps. Only changes while the ball is presnap.
  play.shiftLB = (dir) => {
    if (play.ball.phase !== 'presnap') return false;
    if (dir !== 1 && dir !== -1) return play.lbShift;
    play.lbShift = Math.min(LB_SHIFT_MAX, Math.max(-LB_SHIFT_MAX, play.lbShift + dir));
    play.reset();
    return play.lbShift;
  };

  // Pre-snap defensive front, a key of FRONTS. Only changes while the ball is presnap.
  // A 7-man front replaces any full-11 defence, so it clears defPersonnel.
  play.setFront = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (!Object.hasOwn(FRONTS, key)) return false;
    play.front = key;
    play.defPersonnel = null;
    play.reset();
    return key;
  };

  // Pre-snap run direction, 'left' or 'right'. Only changes while the ball is presnap.
  play.setPlayside = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (typeof key !== 'string' || !Object.hasOwn(PLAYSIDE_SIGN, key)) return false;
    play.playside = key;
    play.reset();
    return key;
  };

  // Pre-snap TE look, a TE_LOOKS key or null. Only changes while the ball is presnap.
  play.setTeLook = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (key !== null && !Object.hasOwn(TE_LOOKS, key)) return false;
    play.teLook = key;
    play.reset();
    return key;
  };

  // Pre-snap defensive script, a key of SCRIPTS or null. Only changes while the ball is presnap.
  play.setScript = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (key !== null && !Object.hasOwn(SCRIPTS, key)) return false;
    play.script = key;
    play.reset();
    return key;
  };

  // Pre-snap defensive call, a CALLS key or null (null = the call for the defensive personnel).
  // Only changes while the ball is presnap.
  play.setCall = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (key !== null && !Object.hasOwn(CALLS, key)) return false;
    play.call = key;
    play.reset();
    return key;
  };

  // Pre-snap play recognition rating for the defence, null or an integer 1-99. Takes effect at the next snap.
  play.setRecog = (v) => {
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 99)) return false;
    play.recog = v;
    return v;
  };

  // The call the defence plays: the explicit call, else the call for its personnel.
  play.currentCall = () => play.call ?? callFor(play.defPersonnel);

  // Pre-snap offensive personnel, a key of PERSONNEL. Only changes while the ball is presnap.
  // Offensive personnel: no-TE look or attached TE.
  play.setPersonnel = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (!Object.hasOwn(PERSONNEL, key)) return false;
    play.personnel = key;
    play.reset();
    return key;
  };

  // Pre-snap full-11 offense, a key of FORMATIONS or null. Sets the formation's default defence.
  play.setFormation = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (key !== null && !Object.hasOwn(FORMATIONS, key)) return false;
    play.formation = key;
    play.defPersonnel = key === null ? null : FORMATIONS[key].defense;
    play.reset();
    return key;
  };

  // Pre-snap full-11 defence, a key of DEF_PERSONNEL or null (null = the FRONTS defence).
  play.setDefPersonnel = (key) => {
    if (play.ball.phase !== 'presnap') return false;
    if (key !== null && !Object.hasOwn(DEF_PERSONNEL, key)) return false;
    play.defPersonnel = key;
    play.reset();
    return key;
  };

  // Scales how fast play.step advances; the only place time scale applies.
  play.setTimeScale = (s) => {
    if (!Number.isFinite(s)) return play.timeScale;
    play.timeScale = Math.min(SIM_SPEED_MAX, Math.max(SIM_SPEED_MIN, s));
    return play.timeScale;
  };

  const baseSide = () => PLAYSIDE_SIGN[play.playside] ?? 1;

  // Rebuilds the pre-snap state in place. Initial state is this same routine.
  play.reset = () => {
    // Null playside reads as left (-1).
    const s = PLAYSIDE_SIGN[play.playside] ?? -1;
    const look = play.teLook ? TE_LOOKS[play.teLook] : null;
    // t = the side the TE lines up on (+1 right, -1 left).
    const t = look ? (look.align === 'play' ? s : -s) : null;
    play.pull = look?.pull ? { id: 'TE', side: -t } : null;
    play.players = buildLineup(los, playKey, {
      front: play.front,
      dlShift: play.dlShift * DL_SHIFT_STEP,
      lbShift: play.lbShift * LB_SHIFT_STEP,
      personnel: play.personnel,
      formation: play.formation,
      defPersonnel: play.defPersonnel,
      mirror: t === -1,
      rbX: play.rbAway ? -s * RB_DX : null,
    });
    initFacing(play.players);
    // Pre-snap read: computed only here, so shifts keep it in sync with the lineup.
    // A pulling TE is not in the numbering (he leaves the line at the snap).
    const def = PLAYS[playKey];
    const numbered = play.pull ? play.players.filter((p) => p.id !== play.pull.id) : play.players;
    play.numbers = play.playside
      ? numberPlay(numbered, { los, centerId: def.ball.start, playside: play.playside })
      : {};
    for (const p of play.players) p.block = null;
    ctx = { seq: 0 };
    play.combos = [];
    play.plan = null;
    play.run = null;
    play.defense = null;
    play.separation = 0;
    Object.assign(play.ball, {
      holder: PLAYS[playKey].ball.start,
      phase: 'presnap',
      t: 0,
      from: null,
      to: null,
    });
    play.ticks = 0;
    play.trace = null;
    play.perception = null;
    play.box = boxCount(worldSnapshot(play.players, { t: 0, los, side: baseSide(), carrierId: null }));
    play.result = null;
    play.alpha = 0;
    acc = 0;
    snapshotPrev();
  };

  play.snap = () => {
    if (play.ball.phase !== 'presnap') return false;
    Object.assign(play.ball, {
      phase: 'snapping',
      from: PLAYS[playKey].ball.start,
      to: PLAYS[playKey].ball.snapTo,
      holder: null,
      t: 0,
    });
    if (play.accel) for (const p of play.players) p.v = 0;
    acc = 0;
    snapshotPrev();
    let plan = null;
    if (scheme) {
      plan = scheme.plan(play.players, play.numbers, los, { box: play.box?.ids ?? null, pull: play.pull });
      play.plan = plan;
      play.combos = plan.combos;
      ctx.combos = plan.combos;
      ctx.pull = play.pull;
      ctx.side = plan.side;
      assignBlocks(play.players, plan.blocks, plan.techs);
    } else {
      assignBlocks(play.players);
    }
    const def = PLAYS[playKey];
    if (def.run) {
      play.run = startRun(play.players, def.run, { snapToId: def.ball.snapTo, playside: play.playside, numbers: play.numbers });
      for (const p of play.players) if (p.team === 'defense') { if (play.recog == null) delete p.recog; else p.recog = play.recog; }
      play.defense = startDefense(play.players, plan?.front ?? readFront(play.players, play.numbers, los), {
        los,
        carrierId: play.run.carrier,
        script: play.script,
        call: play.currentCall(),
      });
    }
    if (trace || play.run) {
      play.perception = createPerception(
        worldSnapshot(play.players, { t: 0, los, side: ctx.side ?? baseSide(), carrierId: play.run?.carrier ?? null, holderId: play.ball.holder ?? null }),
        { centerId: PLAYS[playKey].ball.start },
      );
    }
    if (trace) play.trace = createTrace();
    return true;
  };

  const live = () => play.ball.phase !== 'presnap';

  play.engage = (blockerId, targetId, angle = 'straight') =>
    live() && setBlock(play.players, blockerId, targetId, angle);

  play.join = (blockerId, teammateId, angle) => {
    if (!live()) return false;
    const mate = play.player(teammateId);
    if (!mate || !isBlocker(mate) || !mate.block) return false;
    return play.engage(blockerId, mate.block.target, angle ?? mate.block.angle);
  };

  play.disengage = (blockerId) => live() && clearBlock(play.players, blockerId);

  play.blockersOf = (defenderId) =>
    live() ? engagedOn(play.players, defenderId).map((p) => p.id) : [];

  const advance = (sdt) => {
    const ball = play.ball;
    if (ball.phase === 'dead') return;
    if (ball.phase === 'snapping') {
      ball.t += sdt / SNAP_DURATION;
      if (ball.t >= 1 - 1e-9) {
        ball.t = 1;
        ball.holder = ball.to;
        ball.phase = 'held';
      }
    }
    if (ball.phase === 'presnap') return;
    const starts = play.accel ? play.players.map((p) => [p.x, p.y]) : null;
    if (play.run) {
      const handed = stepCarrier(
        play.players,
        play.run,
        {
          los,
          ballHeld: ball.phase === 'held',
          holdId: PLAYS[playKey].ball.snapTo,
          cues: play.perception ? cuesFor(play.perception, play.run.carrier) : null,
        },
        sdt,
      );
      if (handed) {
        ball.holder = play.run.carrier;
        ball.phase = 'carried';
      }
    }
    ctx.defGoals = play.defense
      ? stepDefense(play.players, play.defense, {
        run: play.run,
        ballPos: play.ballPosition(),
        cues: (id) => (play.perception ? cuesFor(play.perception, id) : null),
      }, sdt)
      : null;
    ctx.committed = play.defense ? play.defense.committed : null;
    ctx.rule = play.retargetRule;
    ctx.fightBlocks = play.fightBlocks;
    ctx.seed = play.seed;
    ctx.moves = play.moves;
    ctx.contest = play.contest;
    ctx.los = los;
    ctx.cues = (id) => cuesFor(play.perception, id);
    play.separation += stepBlocking(play.players, play.ballPosition(), sdt, ctx);
    if (starts) {
      play.players.forEach((p, i) => {
        // Inertia: speed may fall no faster than the ramp rises (ACCEL_TAU), so a
        // substep clipped by contact does not ratchet the next cap down to a crawl.
        const moved = Math.hypot(p.x - starts[i][0], p.y - starts[i][1]) / sdt;
        p.v = Math.min(p.speed, Math.max(moved, p.v * Math.exp(-sdt / ACCEL_TAU)));
      });
    }
    stepFacing(play.players, play.prev, sdt);
    if (play.tackles && ball.phase === 'carried') {
      const end = playEnd(play.players, play.run.carrier);
      if (end) {
        const c = play.player(play.run.carrier);
        ball.phase = 'dead';
        play.result = {
          reason: end.reason,
          by: end.by,
          spot: { x: c.x, y: c.y },
          yards: c.y - los,
          time: (play.ticks + 1) * FIXED_DT,
        };
      }
    }
  };

  // Fixed-tick clock: whole FIXED_DT ticks from an accumulator, so the result
  // does not depend on the frame rate or time scale the caller steps with.
  play.step = (dt) => {
    if (play.ball.phase === 'presnap') return;
    acc += dt * play.timeScale;
    let n = 0;
    while (acc >= FIXED_DT - 1e-9 && n < MAX_TICKS_PER_STEP) {
      snapshotPrev();
      const wasDead = play.ball.phase === 'dead';
      advance(FIXED_DT);
      acc -= FIXED_DT;
      play.ticks += 1;
      if (play.perception && !wasDead) {
        const t = play.ticks * FIXED_DT;
        observe(play.perception, worldSnapshot(play.players, { t, los, side: ctx.side ?? baseSide(), carrierId: play.run?.carrier ?? null, holderId: play.ball.holder ?? null }));
        if (play.trace) recordTick(play.trace, play.perception, play.players, { t, defense: play.defense, run: play.run });
      }
      n++;
    }
    if (acc >= FIXED_DT - 1e-9) acc = 0; // runaway frame: drop the excess
    if (acc < 0) acc = 0;
    play.alpha = Math.min(acc / FIXED_DT, 1 - 1e-12);
  };

  play.cuesOf = (id) => (play.perception ? cuesFor(play.perception, id) : null);

  play.traceOf = (id) => (play.trace ? entriesOf(play.trace, id) : []);

  play.ballPosition = () => {
    const { holder, from, to, t } = play.ball;
    if (holder) {
      const h = play.player(holder);
      return { x: h.x, y: h.y };
    }
    const a = play.player(from);
    const b = play.player(to);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  };

  play.reset();
  return play;
}
