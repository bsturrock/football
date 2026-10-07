# Blocking engagement

Blocks on the line should look and play like real football: blockers arrive with leverage, hit, sustain with visible push and hand-fighting, and defenders shed by technique and rating, so run results come from the trench fight rather than from assignment quirks. Assignment rules (who blocks whom) are built (B-007-6..13); this area is what happens once a blocker has his man. The user asked for the overhaul (user 2026-10-07, L-1007-058: "it doesn't look great"; L-1007-059: what looks wrong is "Engagement").

## Map

- **Approach** blocker path and aim point to the defender's offense-side, shaded toward the runner (offense.js driveAt, movement.js steerVel get-off boost).
- **Contact** engaged at 1.4 yd (p.eng, p.locked); first-contact pop by momentum (defense.js pop).
- **The fight** discrete battle cycle in blocking.js: set 0.2-0.4 s, a 0.45 s speed or power move won on a rating sigmoid, drive 2-3 yd/s, blocker recovery 0.8-1.4 s, pancake on a momentum score.
  - **Square and locked** `packaged B-020` blocker and defender stay engaged face to face, like real football; today defenders rotate while being blocked, which is the main problem (user 2026-10-07, L-1007-061: "I want the two players to be engaged and look like real football. Right now defenders rotate while being blocked").
  - ? what turns a defender while blocked: facing set from his pursuit target, from the battle push, or the physics body; and what should set it instead (asked 2026-10-07)
- **Shed and release** defense.js avoidBlockers: fight-through roll (shed/99 - 0.3) or step-around 1.6 yd; a beaten blocker cannot re-engage for 0.9 s.
- **Look** block poses in animation.js (swim, bull rush, recover, hold). Animations do not look good, a polish point after engagement (user 2026-10-07, L-1007-061).
- **Tuning after** run bands (ypc, stuffs, big runs) are tuned only after this lands (user 2026-10-07, L-1007-059: split B-006-7).
- **Folded tuning and rule items** systems, not plays or positions (user 2026-10-07, L-1007-057): double/climb (B-012), pull reach (B-013), stunt awareness (B-014), claim order (B-015, B-016), left/right gap (B-017), Draw blockers (B-018); which of them this area absorbs is decided at packaging.

## How it works today

- Two models mix: a kinematic battle (blocking.js) for most bodies, and the physics world for ragdoll and tackle bodies (defense.js:138); `separate()` pushes unlatched pairs apart under 0.8 yd.
- Run-mode bias: OL and TE get a -1.4 offset on the win sigmoid (fire-out), receivers +0.3 (stalk blocks shed easily).
- Constants: blocking.js MOVE_TIME 0.45, PANCAKE_AT 6.5; blockrules.js ENGAGED 1.4; defense.js AVOID_CONE 30, AVOID_DIST 2.5, AVOID_T 0.5, FIGHT_QUICK 0.15.
- Physics engine calls stay in physics.js, tackling.js and pile.js (CLAUDE.md design rule, user L-1006-146).
- Why defenders rotate (PM read, 2026-10-07): facing is set per frame in animation.js:59-62 from `p.faceAt` if set, else from velocity (speed over 0.4). Blockers get `faceAt` = their man (offense.js:33), so they square up. Defenders get `faceAt` only in a tackle (tackling.js), never while blocked, so a blocked defender faces wherever he is moving: sideways while stepping around, and toward his own end zone while driven back at 2-3 yd/s. Leverage is already shown by position (offense.js:36 shoulder offset; defense.js `lev`), not facing.

## Proposal (asked 2026-10-07)

- While engaged (`p.eng > 0` or in a battle), the defender's `faceAt` is his blocker, so both face each other square; a drive back moves the pair without turning them; leverage shows as the shoulder offset, with at most a small cap (about 20 deg) on how far either turns off square; facing frees on shed or release.
- Physics bodies (bubble yaw, physics.js:230) follow the same `faceAt`, so no extra physics work.
- The drill page (B-019) is where the user judges before and after.

## Package

### B-020 Blocked defenders face their blocker square and a drive back no longer turns the pair

- Line: `[ai]`, `## Backlog`, Size M, Depends on: B-019 (the user's judging page; the sim half does not need it). Source: design blocking 2026-10-07 (user L-1007-064).
- User sees: blocker and defender stay chest to chest through a drive; leverage shows as a slight shoulder turn (at most `FACE_LEAN_MAX` 20 deg); on a shed or a beaten blocker the defender turns back to the play within 0.3 s.
- Rules: engaged = `d.bt && d.bt.o`; the defender's `faceAt` = his blocker, set in defense.js where the battle starts or holds (~:256-273), cleared in blocking.js where `d.bt = o.bt = null` (:49, :56, :83) only when `d.faceAt === d.bt.o` (never clear a tackle's `faceAt`). Not held by the 0.15 s `eng` decay. Double team: blockers face the one defender, defender faces the nearer blocker. Pancaked or stunned defenders keep today's behaviour (PM call). Pull and kick-out facing unchanged.
- Lean: turn off square = `FACE_LEAN_MAX * clamp(lat / LEAN_LAT, -1, 1)`, `lat` the pair's sideways offset, `LEAN_LAT` 0.6 yd; lean into each other: blocker toward the runner side, defender the opposite way (user 2026-10-07, L-1007-065). Computed by one shared helper in util.js that animation.js and physics.js `physYaw` both call (PM call: no new `p` field).
- Measure: sim JSON gains `facing {frames, sqPct, errDeg, maxLeanDeg}` over engaged-defender frames (sim.js hook under this item; PM call). Pass `sqPct` >= 90, `errDeg` <= 12 at `?sim=100&seed=7` (starting guesses; before-number on main in the done-report). ypc, stuffPct, freeBox move no more than seed noise.
- Stateful: yes (free, engaged, in a tackle): states-and-transitions table before code.
- Files: src/defense.js, src/blocking.js, src/animation.js, src/util.js, src/sim.js (shared with B-006-7: build after it merges). Talks to physics.js `physYaw` (one helper call), tackling.js (shares `faceAt`).
- Out: block poses, run-band tuning, B-012..B-018 (none absorbed: they touch assignments, not facing).
- Unblocks: block-pose polish ("Look"), run-band tuning, B-012..B-018.


## Landed

- B-020 merged 14b7b23 (user L-1007-074): defender faces his blocker through a battle and through gaps under 0.25 s while the blocker is in front (util.js holdsBlocker, HOLD_R 1.8, HOLD_T 0.25, HOLD_V 0.4); lean via util.js faceLean (FACE_LEAN_MAX 20 deg, LEAN_LAT 1.0 yd), run plays after the handoff only, not pullers or physics bodies. Sim ?sim=100&seed=7: sqPct 84 (main ~15), errDeg 12.4, turnBack median 0.07 s.
- Review notes kept here: a defender also goes engaged -> free directly when the battle drops and the hold test already fails (defense.js sweep nulls faceAt); turnBack drops cases where the defender stands still after a shed, so its n is low.
