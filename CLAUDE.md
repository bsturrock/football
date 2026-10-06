# Gridiron Drive (Football)

A browser American-football game in plain JavaScript ES modules: `index.html` loads three.js r128 from cdnjs and `src/main.js`; physics in `src/physics.js` (cannon-es style rigid parts). No build step, no package.json.

Team process: a project-manager (PM) leads; workers build on their own branches and worktrees (`../football-wN`); the PM moves main. Backlog: `docs/BACKLOG.md` (shape in its header). Process rules: `~/.claude/pm-board/ROLES.md`.

## Run and serve

- Serve: `npx vite --host 127.0.0.1 --port <port> --strictPort` from the repo root (plain index.html; no config needed).
- Open http://127.0.0.1:<port>/.

## Checks

- Fast check: `for f in src/*.js; do node --check "$f" || exit 1; done` (syntax only).
- Full check: the fast check, then load the page in the agents' browser and confirm no console errors and a play runs (snap, pass or run, play ends).
- No smoke, trace, perf or docs check yet; skills skip those steps for this repo until they exist.

## Where things live

| system | files |
|---|---|
| core | src/main.js, src/state.js, src/util.js |
| render | src/scene.js, src/camera.js, src/animation.js, src/markers.js |
| physics | src/physics.js, src/movement.js, src/blocking.js, src/tackling.js |
| ai | src/offense.js, src/defense.js, src/cpu.js |
| play | src/playbook.js, src/rules.js, src/players.js, src/carrier.js |
| input | src/input.js |
| ui | src/hud.js, index.html |
| docs | CLAUDE.md, docs/ |

## Design rules

To be written by the PM with the user (design-talk). Until then: keep modules small and single-purpose, no globals beyond `state.js`'s `S`, tunables as named constants at the top of their module.
