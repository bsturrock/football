// ---------- offensive formations ----------
// Pure data and functions (no imports), so sim.js can validate ?form= before the bodies exist; lineUp is handed the bodies.
// x is yards from the center on the base (right-hand) side; dy is yards behind the line. flip -1 mirrors every skill player
// (QB, backs, TE, WR) across the center; the five linemen stay. A formation names its personnel (roster.js PERSONNEL.off), so subIn
// puts its fullback and second tight end on the field. `under`: the QB is under center (otherwise shotgun).
// B-021: NFL splits, 3-4 ft between linemen (center to center 1.35 yd = 4 ft); the tight end is one split outside the tackle, the center is
// OL_BACK yd behind the line and the V (B-053) sets each guard and tackle deeper by OL_SETBACK per slot (GUARD_BACK, TACKLE_BACK), the tight end level with his tackle (TE_BACK). fronts.js builds its alignment grid from the same OL_GAP.
// B-027 neutral zone: the ball is one ball length deep (NEUTRAL_Z, about 0.31 yd), centred on the line; only the snapper's hands reach in.
// A lineman stands STANCE_REACH (hands to body centre) outside the zone's edge, so OL and DL centres are NEUTRAL_Z + 2*STANCE_REACH = 2.31 yd (B-033: hands at the ball tips, helmet fronts over them, so the daylight between helmets is NEUTRAL_Z) apart.
export const NEUTRAL_Z = 0.31, STANCE_REACH = 1.0;
const QB_UNDER = 0.6, WR_OFF = 0.75;   // the QB under center stands QB_UNDER behind the center (>= SEP_R 0.56, so separate() leaves the center alone); the third WR stands WR_OFF behind the OL line
export const OL_GAP = 1.35, OL_BACK = NEUTRAL_Z/2 + STANCE_REACH, OLD_GAP = 2.2;
export const GRID_K = OL_GAP/OLD_GAP;   // a lateral number written on the old 2.2 yd line grid (a gap x, a hole, a lane window) times this sits on the new one
export const BOX_X = 8*GRID_K;   // the box's half width (blockrules.js's 'any' rule, sim.js's boxMean)
// B-053: the line sets in a shallow V, the center furthest up (hand on the ball); a guard / tackle is set back this many yd more than the center, the tight end level with his tackle.
export const GUARD_BACK = 0.25, TACKLE_BACK = 0.5;
const OL_SETBACK = [TACKLE_BACK, GUARD_BACK, 0, GUARD_BACK, TACKLE_BACK];   // by OL index, left tackle to right tackle
const TE_BACK = OL_BACK + TACKLE_BACK;
const TE_X = 3*OL_GAP;
const WR_X = [-20, 20, -11];   // WR slots by index; a personnel with fewer receivers uses the first ones
export const FORMS = [
  {name:'11 Gun',   pers:'11', under:false, qb:4.5, rb:[1.8, 4.5], te:[TE_X, TE_BACK], wr:WR_X},
  {name:'11 Under', pers:'11', under:true,  qb:OL_BACK + QB_UNDER, rb:[0, 6.5],   te:[TE_X, TE_BACK], wr:WR_X},
  {name:'21 I',     pers:'21', under:true,  qb:OL_BACK + QB_UNDER, rb:[0, 6.8],   te:[TE_X, TE_BACK], fb:[0, 4.0], wr:WR_X},
  {name:'12 Under', pers:'12', under:true,  qb:OL_BACK + QB_UNDER, rb:[0, 6.5],   te:[TE_X, TE_BACK], te2:[-TE_X, TE_BACK], wr:WR_X},
  {name:'22 Heavy', pers:'22', under:true,  qb:OL_BACK + QB_UNDER, rb:[0, 6.8],   te:[TE_X, TE_BACK], te2:[-TE_X, TE_BACK], fb:[0, 4.0], wr:WR_X}
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
  OL.forEach((o, i) => place(o, (i-2)*OL_GAP, los - OL_BACK - OL_SETBACK[i]));
  place(QB, 0, los - form.qb);
  place(RB, form.rb[0]*flip, los - form.rb[1]);
  place(TE, form.te[0]*flip, los - form.te[1]);
  WRs.forEach((w, i) => place(w, form.wr[i]*flip, los - (i < 2 ? OL_BACK : OL_BACK + WR_OFF)));
  EXTRA.forEach(e => { const s = e.pos === 'FB' ? form.fb : form.te2; place(e, s[0]*flip, los - s[1]); });
}
