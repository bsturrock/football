# Player mind: mental vs physical ratings

Each player has mental ratings for how well he knows his scheme and his assignment, and physical ratings for how good he is. Assignments come from each player's own rule for the formation and play, so a blocker who doesn't know the scheme blocks the wrong man or is late, and a blocker who knows it but is weak still loses the rep (user L-1007-091, 2026-10-07).

## Map

- **Mental vs physical split** Mental ratings decide what a player tries (right man, right time, right call); physical ratings decide whether it works (user L-1007-091, 2026-10-07). One framework for every position, blockers built first (user 2026-10-07, L-1007-095).
  - **Scheme knowledge** One 0-99 rating per scheme family (zone, gap/power, pass pro) per player (user 2026-10-07, L-1007-095); a miss is a bust: wrong man, wrong gap, late pull or climb, a combo that never climbs.
  - **Recog stays separate** Play recognition remains reading the defense during the play (stunts, keys), not knowing your own job (user 2026-10-07, L-1007-095).
  - **Calls by the smart player** The center's Mike ID and the QB's check-outs from their mental ratings: later, not in the first build (user 2026-10-07, L-1007-096).
- **Assignments per player** Each slot's rule per play, read against the front at the snap (blockrules.js, playbook.js); varies by formation and play type (user L-1007-091, 2026-10-07).

## Today (main 8fa4348)

- Nine 0-99 ratings per player from position templates (src/ratings.js KEYS): speed, accel, strength, agility, vision, tackling, shed, pursuit, recog. FLAT_RATINGS is true (ratings.js:58), so every player plays the same today.
- The only mental rating used by blockers is recog: it drives the wrong-man and late re-read on crossing stunts (blockrules.js:161, :190, :195; B-007-9, B-014). Pullers and doublers are exempt.
- Rules belong to the slot in the play data (playbook.js), settled at the snap in a fixed claim order (blockrules.js resolveBlocks :126). Who stands in the slot changes nothing but his recog roll.

## Interactions

- play: ratings.js (new keys, templates), playbook.js (rules per slot), blockrules.js (where a bust is rolled).
- ai: cpu.js (check-outs), offense.js (block, climb timing), carrier.js (a back who reads the Mike on Duo).
- core: sim.js (bust rates per rating, the same seed giving the same line).
- Related backlog: B-030 (Power and Counter rules, running), B-012/B-025 (doubles), B-014 (stunt awareness), B-015 (Duo), B-016 (Trap claim order).

## Package

Drafted 2026-10-07 (packager), framework only (user L-1007-096). One parent (size L, base main) with four parts; ids assigned at filing. Order: -1 now; -2 after -1 and B-030; -3 and -4 in parallel after -2.

Structural (PM, 2026-10-07): mental ratings live in a new `MENTAL = ['zone','gap','pass']` list with an `m` array per template in src/ratings.js, kept out of `KEYS` (roster.js OVR_W, sim teamAvg and the legacy aliases walk KEYS). Family map in blockrules.js: `scheme:'zone'` uses zone, `scheme:'man'` uses gap; pass stored for later. New debug array `S.bust` = [{name, fam, know, kind}] set at the snap by resolveBlocks. New sim param `&know=N`. A zone bust takes the neighbour lane away from the hole (PM). Busts show in play only as their result (a free defender, a late guard); no on-screen label.

### Part 1 [play] Every player carries three mental ratings (zone, gap, pass pro knowledge, 0-99)
Done when: p.rt.zone/gap/pass exist for every player in flat and rolled modes; flat gives the template midpoint; KEYS, overall() and sim teams unchanged; `?sim=100&seed=7` line identical to main; no console lines. Starting ranges (tune in playtest): OL 55-80 all three; TE 45-65/45-65/40-60; RB 45-65/45-65/35-55; WR, QB, defenders 30-60 placeholders. Owner: src/ratings.js. Size S.

### Part 2 [ai] A blocker rolls a bust at the snap by his knowledge of the play's scheme family
Done when: S.bust has one entry per rolled blocker; forced Inside Zone N=300: 0 busts at know 99, wrong-man share 12-17% at know 35; same seed same line; default pooled 300 plays seeds 7-9 stay in ypc 3.9-4.7, stuffs 15-25%, 10+ runs 7-13% (lower BUST_MAX first if not); no console lines. Rules: bust chance BUST_MAX 0.35 * (1-know/99)^2, one draw per blocker at the snap, always drawn; a single blocker busts to his next rule's man or the neighbour lane away from the hole, his own man stays free; a puller busts late, a climber late or noclimb (applied in part 3); the recog stunt roll is skipped for a blocker who already busted. Owner: src/blockrules.js resolveBlocks. Depends on: part 1, B-030. Size M.

### Part 3 [ai] A busting puller leaves late and a busting climber climbs late or never
Done when: late pullers reach their target 0.4 s+ later at know 35 on Power; late climbers climb LATE_CLIMB_T later; a noclimb climber stays on the double while the post man is alive; nothing changes at know 99; no console lines. Starting numbers: LATE_PULL_T 0.4 s, LATE_CLIMB_T 0.5 s. States table before code (pull set+late, double+late, double+noclimb). Owner: src/blockrules.js pullCheck/climbCheck, src/offense.js runBlock via branch. Depends on: part 2. Size M.

### Part 4 [core] The sim reports bust rates per family and by knowledge band, and `&know=N` forces blocker knowledge
Done when: sim line gains bust {plays, rolled, byFamily {zone, gap: rolled, busts, pct, byKind}, byBand}; `&know=N` sets zone/gap/pass of every OL, TE and FB, re-applied after each team regen, echoed in force, a non-number gives {"error":...}; know 20 busts more than know 99 (0); same seed same line; header comment of src/sim.js updated; no console lines. Owner: src/sim.js. Depends on: part 2. Size S.

Not ready: none blocking. Open for the user: busts in a default game (about 20% of plays carry one at starting numbers, guarded by the ypc band).
