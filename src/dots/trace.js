// Trace: per-tick record of what each player saw, decided and why. Pure; reads, never steers.
// Never mutates players, play.run or play.defense. Cues come from perceive.js cuesFor.
import { cuesFor } from './perceive.js';

export const TRACE_MAX_TICKS = 1800; // 30 s of ticks; oldest dropped beyond it

export function createTrace() {
  return { ticks: [], last: {} };
}

export function decisionOf(p, { defense = null, run = null } = {}) {
  if (p.block) {
    const foot = p.block.foot;
    return { kind: 'block', target: p.block.target, tech: foot?.tech ?? null, phase: foot?.phase ?? null, engaged: !!p.block.engaged };
  }
  const agent = defense?.agents?.[p.id];
  if (agent) return { kind: 'defend', behavior: agent.behavior, state: agent.state };
  if (run && run.carrier === p.id) {
    return { kind: 'carry', lane: run.lane ? run.lane.side + ' ' + run.lane.name : null, locked: !!run.locked, carried: !!run.carried, call: run.call ?? null };
  }
  return { kind: 'none' };
}

function reasonOf(decision, p, { t, defense, memory, run }) {
  if (decision.kind === 'block') {
    if (memory.switched) return memory.switched;
    return 'rule: ' + (decision.tech ?? 'nearest');
  }
  if (decision.kind === 'defend') return 'trigger: ' + defense.agents[p.id].why;
  if (decision.kind === 'carry') return decision.locked ? `${run.call}: ${run.why}` : 'pressing';
  return '';
}

export function recordTick(trace, perception, players, { t, defense = null, run = null } = {}) {
  const out = {};
  for (const p of players) {
    const decision = decisionOf(p, { defense, run });
    const memory = trace.last[p.id] ?? (trace.last[p.id] = { target: undefined, switched: null });
    if (decision.kind === 'block') {
      if (memory.target != null && memory.target !== decision.target) {
        memory.switched = 'switched from ' + memory.target + ' at ' + t.toFixed(2) + ' s';
      }
      memory.target = decision.target;
    }
    out[p.id] = { read: cuesFor(perception, p.id), decision, reason: reasonOf(decision, p, { t, defense, memory, run }) };
  }
  trace.ticks.push({ t, players: out });
  if (trace.ticks.length > TRACE_MAX_TICKS) trace.ticks.splice(0, trace.ticks.length - TRACE_MAX_TICKS);
  return trace;
}

export function entriesOf(trace, id) {
  const res = [];
  if (!trace) return res;
  for (const tick of trace.ticks) {
    const e = tick.players[id];
    if (e) res.push({ t: tick.t, read: e.read, decision: e.decision, reason: e.reason });
  }
  return res;
}
