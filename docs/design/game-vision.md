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
      - **Rules first** Talk starts now with blocking rules per play and the run playbook (counter, trap, draw); techniques (hands, leverage) after B-005-3 shows what bodies cost and look like (user 2026-10-06, L-1006-084).
      - **Today's schemes** Zone plays shift lanes (each lineman blocks whoever shows in his lane, else climbs); Power is a fixed defender list written against the base front, so it doesn't adjust to slants, blitzes or 8 in the box; no doubles or combos, no reach, down or kick-out technique (playbook.js:30-45).
      - ? Line play: physics-driven bodies or a richer kinematic model with ragdoll moments (asked 2026-10-06)
  - **Player AI and behaviour** Starting focus (user 2026-10-06, L-1006-079): defender reads and keys, pursuit angles that respect blockers, RB vision (press, cut, follow blocks), effort and fatigue. Today: pursuit aims at an intercept point with an awareness error and no blocker avoidance (defense.js), RB scores lanes by race-to-spot (carrier.js).
    - **First up: RB vision and pursuit** The runner against the pursuit is the core of a run; reads and effort follow (user 2026-10-06, L-1006-081).
    - **Human mistakes** Players misread, overrun plays and take bad angles, more often at lower ratings, so big runs come out naturally (user 2026-10-06, L-1006-081).
    - **NFL-style ratings** Every player gets a fuller rating set (speed, acceleration, strength, agility, vision, tackling, block shedding, pursuit, play recognition) that drives behaviour (user 2026-10-06, L-1006-081).
    - **RB reads blocks live** He presses the designed hole so defenders commit, reads the first unblocked defender in the gap, then hits it, bends, bounces or cuts back; follows the lead blocker's hip on power plays; finishes falling forward. Higher vision = more patience and better choices; low vision = wrong hole, running into his own linemen (user 2026-10-06, L-1006-082).
    - **Pursuit with leverage** Each defender's angle comes from the runner's speed and his pursuit rating; keeps leverage (inside-out, edge contain, backside stays home for the cutback); goes around or fights through a blocker in his path; mistakes by rating: overpursuit, bad angle, caught in the wash (user 2026-10-06, L-1006-082).
    - **Ratings 0-99** Position templates (power vs speed back, run-stuffing vs coverage LB) with random variation per player; both teams generated (user 2026-10-06, L-1006-082).
    - **Judged by NFL numbers** The 100-play sim against NFL run numbers (about 4.3 yd per carry, about 1 in 5 runs stuffed at 0 or less, about 1 in 10 going 10+), plus the user's eye; targets tuned with the user (user 2026-10-06, L-1006-082).
    - **Effort and fatigue** Later, after the run core works (user 2026-10-06, L-1006-081).
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

## Package: Player AI

Drafted 2026-10-06 for the Player AI subtree (RB vision, pursuit, ratings); effort and fatigue out; not filed until the user says yes.

Order: B-?-1 (ratings) now; B-?-2 (sim stats) after B-005-1 merges; B-?-3 (RB read) and B-?-5 (pursuit) in parallel after B-005-3 merges (both edit the gates it rewrites); B-?-4 after B-?-3, B-?-6 after B-?-5 (same files); B-?-7 (tuning) last. physics.js, blocking.js, tackling.js, movement.js are off-limits: ratings reach them through the old fields.

Structural (PM, 2026-10-06): new src/ratings.js (play) exporting rateTeams, lack(p,key) = 1 - p.rt[key]/99 and the template table; field p.rt; teams generated at every newGame and every 20 sim plays; S.read debug state; AI items add sim keys additively; tunables as module constants (no src/data). Ratings are absolute across positions like NFL video games (a DT's speed rating is lower than a CB's), mapped to speed, acceleration and turning by one global curve per rating, calibrated so template midpoints match today's position speeds within about 5% (PM per the user's "0-99 like NFL video games", L-1006-082). No ratings display yet. Keyboard-carrier path untouched; all AI under CPU mode.

### B-?-1 Every player gets nine 0-99 ratings from a position template
1. User sees: backs differ (power vs speed), linebackers differ (stuffer vs coverage), each game has different teams; play looks the same on average.
2. Done when: ratings.js is pure (no THREE) and node-testable on fake players: integers 0-99 inside template ranges plus team offset; p.rt = {speed, accel, strength, agility, vision, tackling, shed, pursuit, recog} on all 22; old fields derived (rStr = strength, rAgi = agility, rBrk = (strength+agility)/2 offense, rPow = (strength+shed)/2, rSpd = (speed+agility)/2 defense, rTkl = tackling, rAwr = recog) so the full check passes and 10 CPU plays look as before; newGame regenerates; same seed same ratings (draws via util rand); spd set once per game, not re-rolled per play.
3. Numbers (table atop ratings.js; ranges speed/accel/strength/agility/vision/tackling/shed/pursuit/recog, team offset -4..+4): OL 40-60/45-65/70-92/50-75/45-70/20-35/40-60/30-50/55-80; TE 55-72/55-72/60-80/55-72/50-70/25-40/40-60/35-55/50-70; WR 70-92/68-90/35-55/70-90/55-75/20-35/30-45/35-55/50-70; QB 50-70/45-65/40-55/50-65/60-80/15-25/20-35/20-35/60-80; RB power 70-85/70-85/75-90/60-75/60-85/20-35/30-45/30-45/40-60; RB speed 85-97/82-95/50-68/80-95/60-85/20-35/30-45/30-45/40-60; DE 62-82/65-85/65-85/60-78/50-70/65-80/65-85/60-80/55-75; DT 45-62/50-68/78-95/40-60/45-65/65-80/75-92/50-70/55-75; LB stuff 60-75/60-75/70-88/55-70/60-80/80-95/65-85/65-85/70-90; LB cover 72-88/72-88/50-65/70-85/60-80/65-80/40-60/70-90/65-90; CB 80-95/78-92/35-55/78-92/45-65/60-78/25-45/65-85/55-80; S 72-88/70-86/50-65/68-84/55-75/70-85/40-60/70-85/65-90. RB and each LB 50/50 template; DL0/DL3 DE, DL1/DL2 DT. Starting guesses, tune in playtest.
4. Owner: play. src/ratings.js (new, add to CLAUDE.md systems table), src/players.js, src/state.js (drop per-play spd), src/rules.js (newGame calls rateTeams).
6. Out of scope: ratings UI, fatigue, using vision/recog/pursuit (later parts).
8. Risks: rateTeams before the sim seed is installed. Stateful: no.

### B-?-2 The sim prints NFL run-distribution stats and regenerates teams
2. Done when: ?sim JSON gains ypc, stuffPct (yards <= 0), bigPct (yards >= 10), yards.p10/p90/max, teams; same seed same line; rateTeams every SIM_TEAM_EVERY 20 plays; normal load unchanged; done-report gives the pooled baseline for seeds 7, 8, 9 (100 plays each).
4. Owner: core. src/sim.js. Depends on B-005-1 merged, B-?-1.

### B-?-3 The runner presses, reads the first unblocked defender and picks his lane by vision
1. User sees: the back slows a half-step at the line so defenders commit, then hits, bends, bounces or cuts back; a weak-vision back sometimes runs into his own linemen.
2. Done when: S.read = {key, choice, wrong} once per play; on Inside and Outside Zone the choice follows what the key defender does, lane changes at most once after los+1; sim vision 95 vs 35 (same seed): median yards differ by 0.3+ and wrong share at 35 is 3x+ that at 95; default ratings within 25% of baseline; no new console line.
3. Numbers (atop carrier.js): PRESS_V 0.7*spd for PRESS_T 0.15 + 0.35*vision/99 s (cap 0.6 s); key = nearest unengaged defender within 3 yd of the hole x, y los-1..los+5, re-picked 5x/s until los+1.5; options at los+1: hit (hole), bend (2.2 yd away from the key), bounce (5 yd to the edge, clamp HW-1.5), cutback (4 yd backside); score = raceMargin at los+1 and los+3 minus 0.05*|x-hole| plus noise (1-vision/99)*rand(-1,1); wrong hole with p 0.25*(1-vision/99); locked past los+1.5, then openField.
4. Owner: play. src/carrier.js, src/state.js place() resets. Depends on B-?-1, B-?-2, B-005-3 merged.
8. Stateful: yes, states table first (path, press, read, committed).

### B-?-4 The runner follows his lead blocker, reads the open field and falls forward
1. User sees: on Power the back tucks behind the pulling guard's hip; in the open field he sets up defenders; at contact he drives for the extra yard.
2. Done when: on a pull play he stays within 1.2 yd of the puller's hip until the puller engages or he passes los+2; open-field vision noise (1-vision/99)*0.8 on ofMargin, sim vision 35 vs 95 mean yards 0.3+ lower; when latched and not down he steers straight upfield at 0.6*spd, yards after contact up 0.2+ over 100 plays; pushPlayRate stays <= 0.10; no new console line.
4. Owner: play. src/carrier.js. Depends on B-?-3. No physics.js change (a visible ragdoll lean would be a physics item).
8. Stateful: small table (following, free, contact).

### B-?-5 Each defender's pursuit angle comes from his pursuit rating, with human mistakes
1. User sees: sensible cut-off angles; a speed back outruns slow defenders; low-rated defenders overrun or take bad angles, so some runs break.
2. Done when: intercept() uses the runner's smoothed velocity and d.spd, aim scaled by AIM_K resampled every 0.4 s; sim pursuit 95 vs 35: bigPct at 35 is 1.5x+ and ypc 0.3+ higher; overpursuit visible in some of 10 plays, not most; default within 25% of baseline.
3. Numbers (atop defense.js): AIM_K = 1 + lack(d,'pursuit')*0.8*rand(-1,1); AIM_K over 1.35 holds the future spot 0.5 s after a cutback; d.read = 0.6 - recog/250; BITE_P 0.35*lack(d,'recog') follows the first flow step 0.3 s longer.
4. Owner: ai. src/defense.js. Depends on B-?-1, B-?-2, B-005-3 merged.
8. Stateful: small table (aim, holding, bite).

### B-?-6 Defenders keep leverage, the backside stays home, and they go around or through blockers
1. User sees: the force man keeps the edge, the backside defender stays home against the cutback, defenders slip or fight through blockers; poor ones get walled off.
2. Done when: on Outside Zone a cutback meets a backside defender who stayed within 3 yd of the cutback lane until los+3; a blocker inside a 30 degree cone within 2.5 yd makes the defender step around to his leverage side, or fight through with FIGHT_P = shed/99 - 0.3; pursuit 35 shows stuffPct down and bigPct up; default within 25% of baseline, pushPlayRate <= 0.10.
3. Numbers (atop defense.js): AVOID_CONE 30, AVOID_DIST 2.5, BACK_D 3, LEV_SHADE 0.8*(0.5 + pursuit/200); cone test precomputed every 0.1 s.
4. Owner: ai. src/defense.js. Depends on B-?-5.
8. Stateful: yes, states table first (pursuing, avoiding, fighting, held).

### B-?-7 Sim run numbers land in the NFL bands
2. Done when: 3 seeds x 100 plays pooled: ypc 3.9-4.7, stuffPct 15-25%, bigPct 7-13%, pushPlayRate <= 0.10; the user's 20-play playtest passes; bands are starting values tuned with the user.
3. Rules: named constants only (ratings.js templates, carrier.js, defense.js), no knob moved more than 30%, before and after reported per knob.
4. Owner: ai (constants across play and ai files, PM call). Depends on B-?-4, B-?-6.
