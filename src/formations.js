// ---------- offensive formations ----------
// Pure data and functions (no imports), so sim.js can validate ?form= before the bodies exist; lineUp is handed the bodies.
// x is yards from the center on the base (right-hand) side; dy is yards behind the line. flip -1 mirrors every skill player
// (QB, backs, TE, WR) across the center; the five linemen stay. A formation names its personnel (roster.js PERSONNEL.off), so subIn
// puts its fullback and second tight end on the field. `under`: the QB is under center (otherwise shotgun).
const WR_X = [-20, 20, -11];   // WR slots by index; a personnel with fewer receivers uses the first ones
export const FORMS = [
  {name:'11 Gun',   pers:'11', under:false, qb:4.5, rb:[1.8, 4.5], te:[6.8, 1.0], wr:WR_X},
  {name:'11 Under', pers:'11', under:true,  qb:1.2, rb:[0, 6.5],   te:[6.8, 1.0], wr:WR_X},
  {name:'21 I',     pers:'21', under:true,  qb:1.2, rb:[0, 6.8],   te:[6.8, 1.0], fb:[0, 4.0], wr:WR_X},
  {name:'12 Under', pers:'12', under:true,  qb:1.2, rb:[0, 6.5],   te:[6.8, 1.0], te2:[-6.8, 1.0], wr:WR_X},
  {name:'22 Heavy', pers:'22', under:true,  qb:1.2, rb:[0, 6.8],   te:[6.8, 1.0], te2:[-6.8, 1.0], fb:[0, 4.0], wr:WR_X}
];
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
export const formByName = v => (v == null ? null : FORMS.find(f => norm(f.name) === norm(v))) || null;
// a named formation wins; else the personnel's formation (11 when none is asked for), shotgun or under center as the play wants
export function chooseForm(under, name, pers){
  const named = formByName(name); if(named) return named;
  const pool = FORMS.filter(f => f.pers === (pers || '11'));
  return pool.find(f => f.under === under) || pool[0];
}
// put the eleven on the field; `place(body, x, y)` is state.js's (it also resets the body); B = {OL, QB, RB, TE, WRs, EXTRA} from players.js
export function lineUp(form, los, flip, place, B){
  const {OL, QB, RB, TE, WRs, EXTRA} = B;
  OL.forEach((o, i) => place(o, (i-2)*2.2, los - 0.7));
  place(QB, 0, los - form.qb);
  place(RB, form.rb[0]*flip, los - form.rb[1]);
  place(TE, form.te[0]*flip, los - form.te[1]);
  WRs.forEach((w, i) => place(w, form.wr[i]*flip, los - (i < 2 ? 0.8 : 1.0)));
  EXTRA.forEach(e => { const s = e.pos === 'FB' ? form.fb : form.te2; place(e, s[0]*flip, los - s[1]); });
}
