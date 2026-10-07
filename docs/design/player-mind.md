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
