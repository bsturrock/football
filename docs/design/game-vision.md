# Game vision

A CPU-vs-CPU NFL football sim: a coach sim where the user calls plays and never controls a player. Graphics stay stylized; animations, interactions, physics and overall feel aim for realism while staying visceral and fun (user 2026-10-06, L-1006-067).

Top-line test for all work: would this look right on an NFL broadcast, graphics aside? Gameplay, feel, animation and dynamics should look like real football (user 2026-10-06, L-1006-075).

## Map
- **Coach sim** The user never inputs player controls; both teams are CPU-driven. Playcalling is the user's role, built later (user 2026-10-06).
  - ? When does keyboard control of the carrier/QB go away: now, or when playcalling arrives (asked 2026-10-06)
- **Realistic, visceral feel** Animation, contact, physics and movement read as real football; stylized graphics are fine (user 2026-10-06).
- **Run game** Current focus: build out the run game (user 2026-10-06). Starting focus: tackling, blocking and player AI/behaviour (user 2026-10-06, L-1006-079).
  - **Tackling** Current focus (user 2026-10-06). Today: one rating roll (big hit / whiff / grab), then cannon-es ragdolls with grip constraints and a takedown meter (tackling.js, physics.js).
    - **Pile physics** `packaged B-005` Ragdolls collide with every player on the field: piles hit linemen, teammates push a pile, runners knocked into blockers. Today ragdolls pass through non-ragdoll players (physics.js:45, blocking.js:93). Size L.
      - **Look** Bodies stack and collapse at the line, runner knocked back into his own blockers, pursuers pile on (user 2026-10-06, L-1006-074).
      - **Push the pile** Teammates can drive the pile and runner forward for yards (user 2026-10-06, L-1006-074).
      - **Physics bubble** Dynamic and emergent, not scripted; frame-rate cost accepted since graphics stay light (user 2026-10-06, L-1006-074). PM call: every player near a live ragdoll becomes a full physical body standing on his own legs (bal 1), still driven by his game intent through leg drive and muscles, so pushes, knock-backs and piles come out of real masses colliding; he leaves the bubble once clear and upright. Real-mass bodies avoid the old riding/launch look, which came from infinite-mass animated blockers.
      - **Tug-of-war** Any offensive player near the pile who isn't blocking joins and drives forward; defenders near it drive back; the pile moves toward the side with more push (user 2026-10-06, L-1006-076).
      - **Down rule detail** NFL rule: down when any part other than hands or feet touches the turf (head included), and only by contact: an untouched runner who falls can get up unless a defender touched him in the last 1 s; the stall whistle applies to any held runner, not only piles; a held runner scores when the ball breaks the plane; typical push gain means the median (PM per the NFL rule and L-1006-075, 2026-10-06).
      - **Down in a pile** NFL rule: knee, elbow, butt or torso down (a hand is not down), or the whistle when forward progress stops (pile stalled about 1 s); spot at forward progress (user 2026-10-06, L-1006-076).
      - **Pushes stay rare** Real football first: most tackles end fast, pile pushes are occasional and short. If sims show tug-of-war on most plays, rethink (user 2026-10-06, L-1006-078). Keeps them rare: a pile forms only when the runner is held up, not down, with two or more bodies on him; pushers join only when close and free; the forward-progress whistle ends a stalled pile at about 1 s. Done-when for the pile items: measured over 100 CPU run plays, pile pushes on at most about 1 in 10 plays, median push under 1.5 s, typical push gain 0-2 yd; numbers tuned with the user.
      - **Body cap** About 14 full bodies at once, the rest stay animated; measured and tuned on frame rate (user 2026-10-06, L-1006-076). Target at least 50 fps, physics under 8 ms per frame on the user's machine; if it doesn't fit: cheaper bodies first (sleeping, simpler shapes on far players), then a lower cap, coarser step last; any trim that makes piles look wrong (jitter, tunnelling, floating) goes back to the director (director per L-1006-077, 2026-10-06).
    - **Tackle variety** Form, angle and ankle tackles, strips and fumbles instead of three outcomes from one roll. Size M.
    - ? Down and spot outside piles: same NFL rule for every tackle, and a whistle when a runner is held up (asked 2026-10-06)
  - **Blocking** Current focus (user 2026-10-06). Today: kinematic set/move/resolve cycle on a rating sigmoid, one blocker per defender, contact decided by the defender (blocking.js, offense.js, defense.js).
    - **Physical line play** Hands, pad level and leverage drive who wins; double teams and combos to the second level; reach and down blocks; fronts and slants change fits. Size L.
    - ? Line play: physics-driven bodies or a richer kinematic model with ragdoll moments (asked 2026-10-06)
  - **Player AI and behaviour** Starting focus (user 2026-10-06, L-1006-079): defender reads and keys, pursuit angles that respect blockers, RB vision (press, cut, follow blocks), effort and fatigue. Today: pursuit aims at an intercept point with an awareness error and no blocker avoidance (defense.js), RB scores lanes by race-to-spot (carrier.js).
  - **Runner moves** Stiff-arm, spin, juke, truck, lowered shoulder at contact; press and cut off blocks, follow the lead blocker, fall forward. Today the carrier only picks lanes (carrier.js). Size M-L.
  - **Run playbook** Counter, trap, draw, RB blocking, QB carry-out fake; more than one defense. Size M.
- **Contact feel** Viewpoint is a spectator in the sky box: no camera shake (user 2026-10-06, L-1006-072). Visceral feel comes from on-field animation, physics and sound, not the camera. Candidates: sound, whistle, hit-stop or slow-mo on big hits, replay. Nothing exists today. Size M.
  - ? Do time effects (hit-stop, slow-mo) fit the sky-box spectator view, or only replays (asked 2026-10-06)
  - ? Which feel cues first, and is sound in scope now (asked 2026-10-06)
- **CPU vs CPU** A run play already runs with no input (cpu.js, input.js). Left: remove human-control paths (Shift sprint, control ring), each side calls independently (offense now sees the defensive call), move snap and assignments out of input.js. Size M.
- **Playcalling** Later: the user calls plays for CPU teams (user 2026-10-06).

## Notes

User's words (L-1006-067): realism, but visceral and kind of fun; graphics won't be realistic, but animations, interactions, physics and feel should be. Tackling and blocking are the current focus while building the run game.

## Package

Drafted 2026-10-06 for the Pile physics subtree; filed as B-005, B-005-1..6 (user 2026-10-06, L-1006-080).

How the design keeps pushes rare: a pile exists only when the runner is held up (not down) with 2+ bodies within 1.3 yd; pushers join only within 1.5 yd and free (no line battle, not stunned, balance 0.5+), at most 3 per side; push is leg force scaled by mass and rating, nothing scripted, so a stalled pile stays stalled; the forward-progress whistle ends a pile gaining under 0.3 yd in 1.0 s, spotted at the ball's furthest point; all pushing stops once he is down or the play is dead. The sim (B-005-1) measures piles from game state, not from pile code, so every item is measured the same way.

Order: B-005-1, then B-005-2; B-005-3, B-005-4, B-005-5 after those (B-005-3 and B-005-4 both edit physics.js, different functions: serial merges); B-005-6 last. Smallest playable slice: B-005-1 + B-005-2 + B-005-3.

Structural (PM, 2026-10-06): new src/sim.js (core) and src/pile.js (physics), both added to the CLAUDE.md systems table by their items; exports isBody(p), physCount and a physics-ms counter, physDrive in physics.js; trackProgress in rules.js; state S.prog, S.pile, p.ph.bubble; URL params ?sim=N&seed=S and ?debug; a render-free step(dt) in main.js. Players past the cap stay animated and pass through ragdolls (accepted). Push strength = body mass times rating/80 (rStr offense, rPow defense), tuned in playtest.

### B-005-1 Headless runner plays 100 CPU run plays and prints pile and frame-cost stats
1. User sees: nothing in the game; the team can measure "pushes are rare" instead of guessing.
2. Done when: `?sim=100&seed=7` plays 100 CPU run plays (S.cpu, normal nextPlay/newGame) with no rendering and writes one JSON line into `<pre id="simout">`; the same seed twice gives identical plays, pileWindows, pushPlays; a normal load (no ?sim) is unchanged with no new console line; the CLAUDE.md headless recipe with --dump-dom (alarm raised as needed, worker reports the run time) shows simout; a "Sim check" line is added to CLAUDE.md Checks; with physics failed to load it prints an error JSON.
3. Numbers (constants atop sim.js): SIM_DT 1/60 s; seeded PRNG (mulberry32) replaces Math.random only under ?sim. Keys: plays, yards{mean,median}, pileWindows, pushPlays, pushPlayRate, pushDurS{median,p90}, pushGainYd{median,p90}, bodiesMax, physMs{median,p95}. Pile window = holder not down with 2+ bodies (p.ph) within 1.3 yd for 0.4 s+; duration = push duration; gain = holder's ball y end minus start; push play = a window with 1+ offensive body and gain 0.5 yd+.
4. Owner: core. src/sim.js (new), src/main.js (extract step(dt): cpuTick, liveUpdate, dead-phase steer, physStep; frame calls step then renders), src/physics.js (physCount, physStep time counter).
5. Unblocks every other part.
6. Out of scope: render frame time (headless GPU is software); fixing what the stats show.
7. Test card seed: run seed 7 on main twice: same line, pushPlays near 0, bodiesMax about 2-5.
8. Risks: run time over the alarm (pick N or alarm); seeded random leaking into normal play. Stateful: no.

### B-005-2 Debug line shows frame ms, physics ms and body count
1. User sees: with `?debug`, one HUD line such as `frame 16.7 ms · phys 4.1 ms · bodies 9`; nothing without it.
2. Done when: as above; full check passes.
4. Owner: ui. src/hud.js, index.html, src/main.js. Reads B-005-1's counters.
5. Depends on B-005-1.

### B-005-3 Players near a live ragdoll become full bodies, so ragdolls hit blockers and piles stack
1. User sees: a hit runner knocked back into his own linemen, who give way by weight; bodies stack and fold at the line; pursuers pile on; nobody passes through a pile.
2. Done when: a ragdoll and a nearby standing player collide (user watches 10 CPU plays); bodies never exceed BODY_CAP (sim bodiesMax 14 or less over 100 plays); a player leaves the bubble with no visible pop or sink; bubble defenders still tackle (sim mean yards and tackle share within 20% of before, same seed); sim pushPlayRate 0.10 or less, median push under 1.5 s, median push gain 0-2 yd; at least 50 fps and physics under 8 ms on the user's machine (B-005-2 line), trims in the note's Body cap order; no new console lines.
3. Rules (constants atop physics.js, tune in playtest): BUBBLE_IN 2.5 yd from a live ragdoll's torso (live = bal under 1 or gripped); leave at BUBBLE_OUT 4 yd plus upright (spine y above 0.95), angular speed under 2, 0.5 s clear; BODY_CAP 14, ragdolls and tackle bodies first, then bubble players nearest the runner; join as physOn(p, {bal:1}) with ph.bubble. isBody(p) = p.ph && !p.ph.bubble replaces the d.ph gates in tackling.js, defense.js, carrier.js; bubble defenders keep running their AI and their steer output feeds physLegs; a line battle ends on promote (bt cleared, man kept as blk); bubble bodies hold yaw toward faceAt or heading.
4. Owner: physics. src/physics.js, src/blocking.js, src/tackling.js, src/defense.js, src/carrier.js.
5. Depends on B-005-1, B-005-2. Unblocks B-005-6.
6. Out of scope: pushing (B-005-6); proxies past the cap; line-play rework.
7. Test card seed: 10 plays with ?debug: runner hit at the line goes back into blockers, a 4-8 body pile looks like football, no blocker flying or vibrating, frame line on target.
8. Risks: frame cost (up to 140 parts at 180 Hz, 20 solver iterations); allocation on promote. Stateful: yes, states table first (animated, bubble, tackle body, leaving).

### B-005-4 Runner is down only by contact, on anything but a hand or foot
1. User sees: a runner who plants a hand keeps going; one who stumbles untouched gets up; he is down when a knee, elbow, hip, torso or head touches after contact.
2. Done when: physDown false with only a hand end or foot on the turf, true for knee, elbow end of the forearm, upper arm, thigh/hip, torso, head; a runner with no defender contact in the last 1 s is not down and gets up; over 100 sim plays no play ends on a hand alone and mean yards stay within 20% of before.
3. Numbers (constants atop physics.js): ELBOW_DOWN_Y 0.1 yd at the forearm's elbow end; 0.06 lowest-corner and knee 0.14 stay; CONTACT_T 1.0 s.
4. Owner: physics. src/physics.js physDown, src/tackling.js (contact time).
5. Depends on B-005-1 for measurement. Unblocks B-005-6.
7. Test card seed: watch ten plays for a hand-steady runner who keeps going.
8. Risks: none per frame. Stateful: small (last contact time).

### B-005-5 Spot and touchdown follow the ball, and forward progress is tracked
1. User sees: a runner pushed back is spotted where the ball got furthest; a pile over the goal line scores when the ball crosses, not his hips.
2. Done when: S.prog holds the furthest ball y this play; held-up and pile ends spot at S.prog (probe: back 2 yd after +3 spots at +3); a touchdown when the ball (physBall) reaches y 100 even with the runner down in a pile, not before; out of bounds still at the ball; 100-play sim differs by at most 1 yd outside piles.
4. Owner: play. src/rules.js (trackProgress), src/state.js (S.prog reset in setupPlay), src/main.js (goal and sideline checks use the ball for a body runner).
5. Unblocks B-005-6.
8. Stateful: yes, small table (max over time, reset at snap).

### B-005-6 Teammates drive a held-up runner forward, defenders drive back, and a stalled runner is whistled
1. User sees: now and then (about one run in ten) linemen drive a held-up runner a yard or two against defenders, then the whistle; most tackles end fast; never a long scrum.
2. Done when: over 100 sim plays on two seeds pushPlayRate 0.10 or less, pushDurS.median under 1.5, pushGainYd.median 0-2, bodiesMax 14 or less; no push after the runner is down or the play is dead; a stalled pile or any held runner is whistled within 1.3 s of stalling with banner FORWARD PROGRESS; pushing only through physLegs wanted velocity and force, never set positions; no console lines.
3. Rules (constants atop pile.js, tune in playtest): pile = holder held up (latched tackler or churn, not falling, not down) with 2+ bodies within 1.3 yd; pushers within PUSH_JOIN 1.5 yd, free, up to 3 per side; PUSH_V 2.0 yd/s toward +y or -y; drive p.acc*1.2*(rating/80); states forming, live, pushing, dead; whistle when the holder advances under STALL_D 0.3 yd over STALL_T 1.0 s while held, then endPlay('spot', S.prog, 'FORWARD PROGRESS').
4. Owner: physics. src/pile.js (new: pileUpdate, pileReset), src/main.js (call after tackleUpdate), src/state.js (pileReset in setupPlay), src/physics.js (physDrive wrapper). Publishes S.pile.
5. Depends on B-005-1, B-005-3, B-005-4, B-005-5.
7. Test card seed: 20 CPU runs with ?debug, plus sim JSON on two seeds.
8. Risks: push rate too high (knobs PUSH_JOIN, PUSH_V, caps, STALL_T). Stateful: yes, states table first.
