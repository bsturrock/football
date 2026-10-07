# Gridiron Drive (Football)

A browser American-football game in plain JavaScript ES modules: `index.html` loads three.js r128 from cdnjs and `src/main.js`; physics in `src/physics.js` (cannon-es style rigid parts). No build step, no package.json.

Team process: a project-manager (PM) leads; workers build on their own branches and worktrees (`../football-wN`); the PM moves main. Backlog: `docs/BACKLOG.md` (shape in its header). Process rules: `~/.claude/pm-board/ROLES.md`.

## Run and serve

- Serve: `npx vite --host 127.0.0.1 --port <port> --strictPort` from the repo root (plain index.html; no config needed). To stop it later, launch it in the background with a pidfile at a literal scratchpad path: `npx vite --host 127.0.0.1 --port <port> --strictPort > <scratch>/vite.log 2>&1 & echo $! > <scratch>/vite.pid`. Stop it with `kill $(cat <scratch>/vite.pid)` in a Bash call of its own (policy takes a literal PID or that form, never `kill $VAR`). `$!` is npx's wrapper: if `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` still shows a listener, kill that PID too. Steps: the stop-process skill.
- Open http://127.0.0.1:<port>/.

## Checks

- Fast check: `for f in src/*.js; do node --check "$f" || exit 1; done` (syntax only).
- Full check: the fast check, then load the page in headless Chrome (the agents' browser is off for now, user L-1006-070). Serve as in Run and serve (with the pidfile; stop it after); `<scratch>` is your session scratchpad (an existing directory). Then:
  `~/.claude/pm-board/headless-dump.sh http://127.0.0.1:<port>/ <scratch>/run 40` (args: URL, output prefix, alarm seconds). It writes `<scratch>/run.dom` (the DOM dump) and `<scratch>/run.err` (Chrome's log), stops Chrome once the dump is whole (Chrome otherwise lingers until the alarm), and removes its throwaway profile on exit or a signal (P-436: leftover profiles filled the disk on 2026-10-07). Use this wrapper, never a copied Chrome line or a script of your own around it; for a long run, run the call with run_in_background. Exit 0: dump whole; 142: the alarm came first.
  Pass: `grep ':CONSOLE' <scratch>/run.err | grep -vE '\[vite\]|GPU stall'` prints nothing, and `grep -c '<canvas' <scratch>/run.dom` is 1 or more. Every console message (console.error and warn too) is logged as an INFO CONSOLE line, so any line but the vite and WebGL "GPU stall" noise is a failure. A module that fails to load (a 404, cdnjs unreachable) logs nothing; the missing `<canvas` catches it. A fresh profile per run (the wrapper makes one each time) matters: a reused one can serve cached modules from an earlier build (e.g. another worktree's server on the same port), with no console sign. Whether a play runs (snap, pass or run, play ends) is the user's visual check: say in the done-report what to look at.
- Sim check: serve and run the headless recipe with `?sim=100&seed=7` as the URL (the dump is written when the sim finishes: about 35-40 s for N=100 under swiftshader, longer on a busy machine, so pass 90 in place of 40 as the alarm here, and more if N is larger (roughly 0.4 s a play, so N=300 wants alarm 180 or more); an empty run.dom (exit 142) means the alarm came first). Pass: `grep -o '<pre id="simout">[^<]*' <scratch>/run.dom` prints one JSON line (plays, ypc, stuffPct (yards <= 0), bigPct (yards >= 10), yards {mean, median, p10, p90, max}, teams {regens, every, O, D: mean ratings; rateTeams runs every SIM_TEAM_EVERY = 20 plays, a no-op under flat ratings}, pileWindows, pushPlays, pushPlayRate, spotYards {mean, median: the spot endPlay ended at minus los; a score or turnover uses the last ball y}, pile {whistles, frames per state, pushPlays, pushGainYd, pushDurS: pile.js's own record of plays that reached pushing; session totals}, pushDurS, pushGainYd, bodiesMax, physMs, read {n: zone plays decided, noDecision: stuffed before deciding, wrongPct: share not the noiseless best lane, choices {name: {n, ypc}}, wrongYpc, rightYpc; from S.read}, force, byPlay, boxMean, freeBox, blkEv {stuntPlays: plays with a crossing stunt (slants count) at the snap, passed, missed, wrong: blockers' stunt re-read events from S.blkEv}); the same seed gives the same line; pile counters count tackle/ragdoll bodies only (`p.ph && !p.ph.bubble`) and bodiesMax is the total physics body count. Optional force params `&play=<run play>&front=<defensive call>&form=&side=L|R` (names case-insensitive; an unknown or pass play gives {"error":...}; form and side are echoed only until B-007-3/4). Awareness: `&olrecog=N` sets every OL and TE recog to N (re-applied after each team regen). Personnel: `&pers=11|12|21|22` and `&dpers=nickel|base|odd` (aliases 4-2-5, 4-3-4, 3-4-4; also work on a normal page load; unknown gives {"error":...}); the line then adds force.pers/dpers, field {off, def} (position counts on the last play) and roster {O, D, ids unique, on}. physMs median/p95 are not reliable here: usually null (performance.now doesn't advance within one synchronous task), sometimes a number depending on timing, so never compare them; use `?debug` in a real browser for frame and physics ms. `?sim` seeds Math.random for the whole page; a normal load is unchanged.
- No smoke, trace, perf or docs check yet; skills skip those steps for this repo until they exist.

## Where things live

| system | files |
|---|---|
| core | src/main.js, src/state.js, src/util.js, src/sim.js |
| render | src/scene.js, src/camera.js, src/animation.js, src/markers.js |
| physics | src/physics.js, src/movement.js, src/blocking.js, src/tackling.js, src/pile.js |
| ai | src/offense.js, src/defense.js, src/cpu.js, src/blockrules.js |
| play | src/playbook.js, src/formations.js, src/fronts.js, src/rules.js, src/players.js, src/ratings.js, src/roster.js, src/carrier.js |
| input | src/input.js |
| ui | src/hud.js, index.html |
| docs | CLAUDE.md, docs/ |

## Design rules

To be written by the PM with the user (design-talk). Until then: keep modules small and single-purpose, no globals beyond `state.js`'s `S`, tunables as named constants at the top of their module.
- Physics engine calls (cannon-es: bodies, constraints, world, impulses) stay inside src/physics.js, src/tackling.js and src/pile.js; other modules use only their exported functions (physBall, physDown, physTouched, ...) and the `p.ph` handle as an opaque flag, so a later Rapier swap stays one contained job (user L-1006-146).
