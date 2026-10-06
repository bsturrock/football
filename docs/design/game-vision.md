# Game vision

A CPU-vs-CPU NFL football sim: a coach sim where the user calls plays and never controls a player. Graphics stay stylized; animations, interactions, physics and overall feel aim for realism while staying visceral and fun (user 2026-10-06, L-1006-067).

Top-line test for all work: would this look right on an NFL broadcast, graphics aside? Gameplay, feel, animation and dynamics should look like real football (user 2026-10-06, L-1006-075).

## Map
- **Coach sim** The user never inputs player controls; both teams are CPU-driven. Playcalling is the user's role, built later (user 2026-10-06).
  - ? When does keyboard control of the carrier/QB go away: now, or when playcalling arrives (asked 2026-10-06)
- **Realistic, visceral feel** Animation, contact, physics and movement read as real football; stylized graphics are fine (user 2026-10-06).
- **Run game** Current focus: build out the run game (user 2026-10-06).
  - **Tackling** Current focus (user 2026-10-06). Today: one rating roll (big hit / whiff / grab), then cannon-es ragdolls with grip constraints and a takedown meter (tackling.js, physics.js).
    - **Pile physics** Ragdolls collide with every player on the field: piles hit linemen, teammates push a pile, runners knocked into blockers. Today ragdolls pass through non-ragdoll players (physics.js:45, blocking.js:93). Size L.
      - **Look** Bodies stack and collapse at the line, runner knocked back into his own blockers, pursuers pile on (user 2026-10-06, L-1006-074).
      - **Push the pile** Teammates can drive the pile and runner forward for yards (user 2026-10-06, L-1006-074).
      - **Physics bubble** Dynamic and emergent, not scripted; frame-rate cost accepted since graphics stay light (user 2026-10-06, L-1006-074). PM call: every player near a live ragdoll becomes a full physical body standing on his own legs (bal 1), still driven by his game intent through leg drive and muscles, so pushes, knock-backs and piles come out of real masses colliding; he leaves the bubble once clear and upright. Real-mass bodies avoid the old riding/launch look, which came from infinite-mass animated blockers.
      - **Tug-of-war** Any offensive player near the pile who isn't blocking joins and drives forward; defenders near it drive back; the pile moves toward the side with more push (user 2026-10-06, L-1006-076).
      - **Down in a pile** NFL rule: knee, elbow, butt or torso down (a hand is not down), or the whistle when forward progress stops (pile stalled about 1 s); spot at forward progress (user 2026-10-06, L-1006-076).
      - **Pushes stay rare** Real football first: most tackles end fast, pile pushes are occasional and short. If sims show tug-of-war on most plays, rethink (user 2026-10-06, L-1006-078). Keeps them rare: a pile forms only when the runner is held up, not down, with two or more bodies on him; pushers join only when close and free; the forward-progress whistle ends a stalled pile at about 1 s. Done-when for the pile items: measured over 100 CPU run plays, pile pushes on at most about 1 in 10 plays, median push under 1.5 s, typical push gain 0-2 yd; numbers tuned with the user.
      - **Body cap** About 14 full bodies at once, the rest stay animated; measured and tuned on frame rate (user 2026-10-06, L-1006-076).
    - **Tackle variety** Form, angle and ankle tackles, strips and fumbles instead of three outcomes from one roll. Size M.
    - ? Down and spot outside piles: same NFL rule for every tackle, and a whistle when a runner is held up (asked 2026-10-06)
  - **Blocking** Current focus (user 2026-10-06). Today: kinematic set/move/resolve cycle on a rating sigmoid, one blocker per defender, contact decided by the defender (blocking.js, offense.js, defense.js).
    - **Physical line play** Hands, pad level and leverage drive who wins; double teams and combos to the second level; reach and down blocks; fronts and slants change fits. Size L.
    - ? Line play: physics-driven bodies or a richer kinematic model with ragdoll moments (asked 2026-10-06)
  - **Runner moves** Stiff-arm, spin, juke, truck, lowered shoulder at contact; press and cut off blocks, follow the lead blocker, fall forward. Today the carrier only picks lanes (carrier.js). Size M-L.
  - **Run playbook** Counter, trap, draw, RB blocking, QB carry-out fake; more than one defense. Size M.
- **Contact feel** Viewpoint is a spectator in the sky box: no camera shake (user 2026-10-06, L-1006-072). Visceral feel comes from on-field animation, physics and sound, not the camera. Candidates: sound, whistle, hit-stop or slow-mo on big hits, replay. Nothing exists today. Size M.
  - ? Do time effects (hit-stop, slow-mo) fit the sky-box spectator view, or only replays (asked 2026-10-06)
  - ? Which feel cues first, and is sound in scope now (asked 2026-10-06)
- **CPU vs CPU** A run play already runs with no input (cpu.js, input.js). Left: remove human-control paths (Shift sprint, control ring), each side calls independently (offense now sees the defensive call), move snap and assignments out of input.js. Size M.
- **Playcalling** Later: the user calls plays for CPU teams (user 2026-10-06).

## Notes

User's words (L-1006-067): realism, but visceral and kind of fun; graphics won't be realistic, but animations, interactions, physics and feel should be. Tackling and blocking are the current focus while building the run game.
