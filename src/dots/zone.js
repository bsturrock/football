// Zone blocking scheme: turns F-11 zone numbers into block targets and double-team combos.
// Pure: no mutation, ids only.
export const LINE_DEPTH = 2.0;
export const SWITCH_DIST = 4.0;
export const COMMIT_DIST = 0.5;

export function zonePlan(players, numbers, los) {
  const num = (p) => (numbers && numbers[p.id] != null ? numbers[p.id] : null);
  const lineGuys = players.filter((p) => p.team === 'offense' && num(p) !== null);
  const D = new Map();
  for (const p of players) {
    if (p.team === 'defense' && num(p) !== null) D.set(num(p), p);
  }
  const onLine = (d) => d && d.y - los <= LINE_DEPTH;
  const blocks = {};
  const combos = [];
  for (const b of lineGuys) {
    const n = num(b);
    const dn = D.get(n);
    if (onLine(dn)) {
      blocks[b.id] = dn.id;
      continue;
    }
    let m = null;
    let partner = null;
    for (const [k, d] of D) {
      if (k > n && onLine(d) && (m === null || k < m)) {
        const p = lineGuys.find((q) => num(q) === k);
        if (p) { m = k; partner = p; }
      }
    }
    if (m !== null) {
      const dm = D.get(m);
      blocks[b.id] = dm.id;
      if (dn) combos.push({
        owner: b.id, partner: partner.id, target: dm.id, watch: dn.id, watchX: dn.x,
        side: Math.sign(partner.x - b.x) || 1,
      });
    } else if (dn) {
      blocks[b.id] = dn.id;
    }
  }
  combos.sort((a, b) => numbers[a.owner] - numbers[b.owner]);
  return { blocks, combos };
}

export function zoneSwitch(players, ballPos, ctx) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const out = [];
  for (const c of (ctx && ctx.combos) || []) {
    const o = byId.get(c.owner);
    const p = byId.get(c.partner);
    const w = byId.get(c.watch);
    if (!o || !p || !w) continue;
    if (o.block?.target === c.watch || p.block?.target === c.watch) continue;
    if (Number.isFinite(c.watchX) && Math.abs(w.x - c.watchX) >= COMMIT_DIST) {
      const lat = (w.x - c.watchX) * (c.side || 1);
      out.push({ blocker: (lat > 0 ? p : o).id, target: w.id });
      continue;
    }
    const dO = Math.hypot(w.x - o.x, w.y - o.y);
    const dP = Math.hypot(w.x - p.x, w.y - p.y);
    if (Math.min(dO, dP) > SWITCH_DIST) continue;
    const lo = Math.abs(o.x - w.x);
    const lp = Math.abs(p.x - w.x);
    const taker = lp < lo - 1e-9 ? p : o;
    out.push({ blocker: taker.id, target: w.id });
  }
  return out;
}
