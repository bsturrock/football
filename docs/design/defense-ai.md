# Defensive AI: reads, keys and decisions

Each defender plays from what he can see: his keys at the snap (a lineman's helmet and hands, the guards and backs for a linebacker, the line and the receiver for a defensive back), read faster and better by better players. His job comes from the call and the front, and his mistakes come from misreads, not dice. So misdirection, play-action and a good or bad read show up on their own (user L-1010-001, 2026-10-10; L-1008-035/036/037).

## Map

- **Keys and reads** Each position reads a small set of keys after the snap and decides run or pass, and which way, from them; read speed and accuracy by rating (recog). Replaces the play-call peek at the snap (input.js:55, defense.js:331-333) and the ball-drift read (defense.js:179).
  - ? Scope: run defense first, pass coverage shaped now but built after B-083, or both now? (asked 2026-10-10)
  - ? Keys that can be fooled: guards pulling, backs' flow, so counter, trap and play-action fool a defender who reads them (asked 2026-10-10)
- **Position identities** Mike, Will and Sam with jobs of their own (Mike calls the front's strength, Will chases the backside, Sam takes the tight end side), instead of linebackers as slots by x (fronts.js:62).
  - ? Name the linebackers and give each his own job, or keep slots? (asked 2026-10-10)
- **Decisions from the read** Fight through or go around a blocker by where the blocker has him (his leverage side) and his rating, not a coin (defense.js:255 FIGHT_P); fill, spill or squeeze by job; pursuit as today (intercept with rated error).
  - ? Shed by leverage and rating instead of a dice roll (asked 2026-10-10)
- **Pass coverage** Today man only plus deep halves (defense.js:70-75); zones (hook, curl, flat, thirds), breaking on the QB's arm, and pass-rush lanes come later with B-083.
- **Defensive call** Today random each play from DEF_CALLS (state.js:79); a call picked by formation, down and distance comes later.

## Today (main 0217f66)

- defenseAI (defense.js:322) per frame: ball in the air, Draw pass-read, run fit (S.runMode), else rush or cover; then block handling, facing hold, speed.
- Reads: run or pass is known at the snap from the play call (input.js:55 S.runMode, S.runSeen); before the handoff a defender keys the back if the play is a handoff (defense.js:333); LBs read-step with the ball's drift from its snap spot times awareness (:179); the force man's wide() read of the QB or RB moving 1.5 yd his way (:169). No guard, OL or high-hat keys; no play-action.
- Timers: d.read 0.6 - recog/250 (0.22-0.38 s) after the handoff; BITE_P 0.35 by lack of recog (a random bite, not a fake); LB_READ_T 0.6; d.react 0.15-0.45 random on a throw, to the known landing spot.
- Shed: fight through with chance shed/99 - 0.3, else step around (defense.js:237-269).
- Ratings the defense never reads: vision, the scheme knowledge ratings; FLAT_RATINGS true (ratings.js:69).
- Coverage: man by index (state.js:93,104), random cushion; deep halves; no underneath zones. Pass rush: beeline at the QB.

## Interactions

- ai: defense.js (reads, jobs, decisions), fronts.js (identities, strength call), cpu.js (call choice, later).
- play: playbook.js (what a play shows: pull, flow, fake), ratings.js (recog, vision used).
- input/core: input.js:55 (the snap no longer tells the defense), sim.js (read readouts: correct reads, misreads by key).
- physics: blocking.js (leverage side the shed reads), tackling.js unchanged.
- Related: B-097 (run seen, merged), B-072-2 (LB square and shuffle, merged), B-083 (pass rush, held), player-mind (recog stays play recognition).
