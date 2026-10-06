// node tools/test-ratings.mjs : ratings.js on fake players (no browser)
import { rateTeams, TEMPLATES, KEYS, lack, setFlatRatings } from '../src/ratings.js';
import assert from 'node:assert';
const mk = (team, tpl) => ({team, tpl});
const roster = () => [mk('O','QB'), ...Array(5).fill().map(() => mk('O','OL')), ...Array(3).fill().map(() => mk('O','WR')), mk('O','TE'), mk('O','RB'),
  mk('D','DE'), mk('D','DT'), mk('D','DT'), mk('D','DE'), mk('D','LB'), mk('D','LB'), ...Array(3).fill().map(() => mk('D','CB')), mk('D','S'), mk('D','S')];
// today's per-position physics values and legacy rolls (main before B-006-1): [spd, acc, turn]
const old = {OL:[6.6,5.6,5.5], TE:[6.9,6,6.5], WR:[7.7,6.5,8.5], QB:[7,5,6.5], RB:[7.6,7.2,13], DE:[6,6.2,7], DT:[6,5.8,6], LB:[7.05,5.8,7.5], CB:[7.6,6.5,8.5], S:[7.45,6,8]};
const oldAlias = {  // [lo, hi] per alias
  OL:{rStr:[70,90], rAgi:[55,80], rBrk:[50,70]}, TE:{rStr:[60,80], rAgi:[60,75], rBrk:[65,80]}, RB:{rStr:[55,70], rAgi:[60,75], rBrk:[65,85]},
  WR:{rStr:[40,60], rAgi:[60,80], rBrk:[50,70]}, QB:{rStr:[35,45], rAgi:[45,55], rBrk:[40,55]},
  DE:{rPow:[60,80], rSpd:[72,90], rTkl:[65,80], rAwr:[55,80]}, DT:{rPow:[75,92], rSpd:[55,70], rTkl:[65,80], rAwr:[55,80]},
  LB:{rPow:[60,75], rSpd:[60,78], rTkl:[75,90], rAwr:[65,90]}, CB:{rPow:[40,60], rSpd:[65,85], rTkl:[60,78], rAwr:[55,80]}, S:{rPow:[50,65], rSpd:[60,80], rTkl:[70,85], rAwr:[65,90]}};
// flat mode (default): identical midpoints, exact old alias means, template mass, no randomness
setFlatRatings(true);
{
  const r0 = Math.random; Math.random = () => { throw new Error('flat mode must not draw'); };
  const a = roster(), b = roster(); rateTeams(a); rateTeams(b); Math.random = r0;
  const mean = (x, y) => (x + y)/2;
  a.forEach((p, i) => {
    assert.deepEqual(p.rt, b[i].rt);
    const tt = p.tpl === 'RB' ? ['RBp','RBs'] : p.tpl === 'LB' ? ['LBs','LBc'] : [p.tpl];
    KEYS.forEach((k, j) => assert.equal(p.rt[k], tt.reduce((s, n) => s + (TEMPLATES[n].r[j][0] + TEMPLATES[n].r[j][1])/2, 0)/tt.length));
    assert.equal(p.mass, TEMPLATES[tt[0]].mass);
    for(const k of Object.keys(oldAlias[p.tpl])) assert(Math.abs(p[k] - mean(...oldAlias[p.tpl][k])) < 1e-9, p.tpl + k + p[k]);
  });
  const o = a.filter(p => p.team === 'O' && p.tpl === 'WR'); assert.equal(o[0].spd, o[1].spd);
  console.log('flat ok');
}
setFlatRatings(false);   // rolled mode below
const sum = {}, N = 2000;
for(let g = 0; g < N; g++){
  const ps = roster(); rateTeams(ps); assert.equal(ps.length, 22);
  for(const p of ps){
    for(const k of KEYS){ const v = p.rt[k], i = KEYS.indexOf(k), [lo, hi] = TEMPLATES[p.sub].r[i]; assert(Number.isInteger(v) && v >= 0 && v <= 99 && v >= lo - 4 && v <= hi + 4, p.sub + k + v); }
    assert(Math.abs(lack(p, 'speed') - (1 - p.rt.speed/99)) < 1e-12);
    for(const k of Object.keys(oldAlias[p.tpl])) assert(Number.isInteger(p[k]) && p[k] >= 0 && p[k] <= 99, p.tpl + k);
    const s = sum[p.tpl] ??= {n:0, v:[0,0,0], a:{}}; s.n++; [p.spd, p.acc, p.turn].forEach((x, i) => s.v[i] += x);
    for(const k of Object.keys(oldAlias[p.tpl])) s.a[k] = (s.a[k] || 0) + p[k];
  }
}
let bad = 0;
for(const [t, s] of Object.entries(sum)){
  const phys = s.v.map((x, i) => ((x/s.n/old[t][i] - 1)*100).toFixed(0) + '%').join(' ');
  const al = Object.entries(s.a).map(([k, x]) => { const m = x/s.n, [lo, hi] = oldAlias[t][k], mid = (lo + hi)/2; if(Math.abs(m - mid) > 1.5) bad++; return `${k} ${m.toFixed(1)}/${mid}`; }).join(' ');
  console.log(t.padEnd(3), 'spd/acc/turn vs old', phys, '|', al);
}
assert.equal(bad, 0, 'alias means drifted from the old per-position mean');
const seed = a => () => (a = (a*1664525 + 1013904223) >>> 0)/2**32;
const run = () => { const ps = roster(); rateTeams(ps); return JSON.stringify(ps.map(p => [p.rt, p.rStr, p.rPow])); };
const r0 = Math.random; Math.random = seed(7); const a = run(); Math.random = seed(7); const b = run(); Math.random = r0;
assert.equal(a, b); console.log('ok');
