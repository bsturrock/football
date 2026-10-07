# Blocking engagement

Blocks on the line should look and play like real football: blockers arrive with leverage, hit, sustain with visible push and hand-fighting, and defenders shed by technique and rating, so run results come from the trench fight rather than from assignment quirks. Assignment rules (who blocks whom) are built (B-007-6..13); this area is what happens once a blocker has his man. The user asked for the overhaul (user 2026-10-07, L-1007-058: "it doesn't look great"; L-1007-059: what looks wrong is "Engagement").

## Map

- **Approach** blocker path and aim point to the defender's offense-side, shaded toward the runner (offense.js driveAt, movement.js steerVel get-off boost).
- **Contact** engaged at 1.4 yd (p.eng, p.locked); first-contact pop by momentum (defense.js pop).
- **The fight** discrete battle cycle in blocking.js: set 0.2-0.4 s, a 0.45 s speed or power move won on a rating sigmoid, drive 2-3 yd/s, blocker recovery 0.8-1.4 s, pancake on a momentum score.
  - **Square and locked** blocker and defender stay engaged face to face, like real football; today defenders rotate while being blocked, which is the main problem (user 2026-10-07, L-1007-061: "I want the two players to be engaged and look like real football. Right now defenders rotate while being blocked").
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
