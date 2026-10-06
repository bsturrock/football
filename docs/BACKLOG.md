# Football (Gridiron Drive): backlog

The one list of open work. Everything else (system docs' limits and gaps, audit lists, the PM's board) points here.

Line shape: `- **B-nnn** [system] title. Trace: -. Size: S|M|L. Kind: bug|cleanup|perf|tooling (Bugs & fixes only). Source: <where it came from>. Status: open|branch <name>|tasks B-nnn-1..k, base <branch>|blocked by B-nnn|done, merged <hash>|closed <date>: <why>`.

Line body (title, summary, labels): ~/.claude/pm-board/item-standard.md "Line body".
- `[system]` is the owner of the item: one owner per item.
- Trace: `-` (not code, or not applicable); a project that proves behaviour changes adds its own codes to the check.
- Kind (Bugs & fixes top-level lines only; parts inherit the parent's): `bug` something is broken against the current design; `cleanup` code or docs tidying with no change to behaviour; `perf` speed or memory; `tooling` scripts, checks and dev tools.
- Ids are stable and never reused. Finished items (done or closed) move to `## Done` with the merge commit (or closed date); keep the last 20.
- Items finished without a merge (superseded, already fixed, not reproducible) use `Status: closed <YYYY-MM-DD>: <why>`.

Items and tasks (features are names, not ids; see ## Features):
- Everything open is a B-item here: bugs, tuning, debt, perf, design and big new systems alike. New requests are filed here first and get the next free id.
- Two open sections: `## Bugs & fixes` (bugs, perf, debt, tooling; the PM files, orders and schedules it) and `## Backlog` (features the user gets; the user orders it). Order lives in the Switchyard queue, not in this file.
- A task is one worker's unit of work, named by its B-ids: a small item is its own task (`B-012`); small items in the same system and files can be bundled (`B-083+B-084`); a big item is split into parallel tasks `B-nnn-1..k` with their own file ownership.
- Follow-up rounds on a task stack on its branch (`<topic>-2`) under the same task id. Leftovers found in review become new B-items with `Source: B-nnn`.

## Features

- **Pile physics**: piles at the line look and play like real football: bodies collide, stack and occasionally get pushed, spotted by NFL rules. Done when: B-005 done and the user's pile playtest passes. Items: B-005. Status: active
## Bugs & fixes

## Backlog

- **B-005** [physics] Piles look and play like football: ragdolls collide with players near them, bodies stack, teammates push, the whistle comes on forward progress. Today ragdolls pass through every standing player and a pile never moves or gets spotted by real rules. Where: src/physics.js, tackling.js, defense.js, carrier.js, blocking.js, rules.js, main.js, new sim.js and pile.js. Done when: all parts done; over 100 sim plays pushes on at most 1 in 10 (L-1006-078); the user's pile playtest passes. Trace: -. Size: L. Source: design game-vision 2026-10-06. Design: game-vision. Status: tasks B-005-1..6, base main
  - **B-005-1** [core] Headless runner plays 100 CPU run plays and prints pile and physics-cost stats: ?sim=N&seed=S, one JSON line in pre#simout, same seed same result. Where: new src/sim.js, src/main.js (render-free step(dt)), src/physics.js (physCount, physics-ms counter). Done when: card in game-vision ## Package; runs under the CLAUDE.md headless recipe; Sim check line added to CLAUDE.md Checks. Trace: -. Size: M. Source: design game-vision 2026-10-06. Design: game-vision. Status: branch sim-runner
  - **B-005-2** [ui] With ?debug a HUD line shows frame ms, physics ms and body count, so the body cap is tuned on the user's machine. Where: src/hud.js, index.html, src/main.js. Depends on: B-005-1. Done when: card in game-vision ## Package. Trace: -. Size: S. Source: design game-vision 2026-10-06. Design: game-vision. Status: branch sim-runner
  - **B-005-3** [physics] Players near a live ragdoll become full bodies: a hit runner is knocked back into his blockers, bodies stack at the line, pursuers pile on, at most 14 bodies, at least 50 fps and physics under 8 ms. Where: src/physics.js, blocking.js, tackling.js, defense.js, carrier.js. Depends on: B-005-1, B-005-2. Done when: card in game-vision ## Package incl. sim push limits. Trace: -. Size: M. Source: design game-vision 2026-10-06. Design: game-vision. Status: branch pile-bubble
  - **B-005-4** [physics] Runner is down only by contact, when any part but a hand or foot touches; today any part but the feet ends the play, hands included, with or without contact. Where: src/physics.js physDown, src/tackling.js. Depends on: B-005-1. Done when: card in game-vision ## Package. Trace: -. Size: S. Source: design game-vision 2026-10-06. Design: game-vision. Status: open
  - **B-005-5** [play] Spot at forward progress and touchdown when the ball breaks the plane; today the spot is wherever the ball lies when he is down and the goal check uses the torso. Where: src/rules.js, src/state.js, src/main.js. Done when: card in game-vision ## Package. Trace: -. Size: S. Source: design game-vision 2026-10-06. Design: game-vision. Status: open
  - **B-005-6** [physics] Teammates drive a held-up runner forward, defenders drive back, and a stalled held runner is whistled (FORWARD PROGRESS) after about 1 s; rare by design. Where: new src/pile.js, src/main.js, src/state.js, src/physics.js. Depends on: B-005-1, B-005-3, B-005-4, B-005-5. Done when: card in game-vision ## Package incl. sim push limits on two seeds. Trace: -. Size: M. Source: design game-vision 2026-10-06. Design: game-vision. Status: open
## Moved

## Done
- **B-001** [docs] Live build: the user can play main from any computer via GitHub Pages (https://bsturrock.github.io/football/). Now the game runs only on a local vite port, not reachable off-network; expected a public link that works anywhere. Repo is already public; enable Pages from branch main, root (no build step, no Actions; three r128 cdnjs, cannon-es jsdelivr, Google Fonts load fine), push main, verify a play runs at the URL; each push to main then redeploys. Trace: -. Size: S. Kind: tooling. Source: user L-1006-063, L-1006-064 (Pages). Status: closed 2026-10-06: live on GitHub Pages https://bsturrock.github.io/football/ (Pages from main, root); user tested: works (L-1006-068)
- **B-002** [physics] If cannon-es fails to load, physics silently turns off: main.js:77 swallows the import error (`() => {}`), so every tackle and fall skips the ragdoll with no message; expected a visible console error and HUD note. Repro: block cdn.jsdelivr.net, load the page, run a play: no ragdolls, no error. Where: src/main.js:75-77. Trace: -. Size: S. Kind: bug. Source: PM code review 2026-10-06 (L-1006-067). Status: done, merged 8b087c1
- **B-003** [core] Latent state leak: place() does not reset slip, grip, fire or fireDelay between plays; a stale slip or grip can carry into the next snap (fire/fireDelay are re-set at snap, so harden only). Expected: place() resets all four. Repro: read state.js:43 against writers tackling.js:23,43,58 (grip), tackling.js:105-106 (slip), input.js:55-56 (fire, fireDelay). Where: src/state.js:42-45. Trace: -. Size: S. Kind: bug. Source: PM code review 2026-10-06 (L-1006-067). Status: done, merged 8b087c1
- **B-004** [core] Dead code and loose imports, no behaviour change: o.scripted written never read (input.js:65 and state.js:78, remove both), DEF_CALLS.slant and fastLB unread (playbook.js:6-10), unused blitzer arg in assignFits (defense.js:67), unused hit import shadowed by local hit (tackling.js:2/35), global CANNON at tackling.js:116 (import or note it), unused inp in tackleUpdate (tackling.js:69), extra args to steer/steerVel (movement.js:8,30; offense.js:31,109). Expected: removed or wired. Where: those lines. Trace: -. Size: S. Kind: cleanup. Source: PM code review 2026-10-06 (L-1006-067). Status: done, merged 8b087c1
