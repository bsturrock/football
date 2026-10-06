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

## Bugs & fixes

## Backlog

## Moved

## Done
- **B-001** [docs] Live build: the user can play main from any computer via GitHub Pages (https://bsturrock.github.io/football/). Now the game runs only on a local vite port, not reachable off-network; expected a public link that works anywhere. Repo is already public; enable Pages from branch main, root (no build step, no Actions; three r128 cdnjs, cannon-es jsdelivr, Google Fonts load fine), push main, verify a play runs at the URL; each push to main then redeploys. Trace: -. Size: S. Kind: tooling. Source: user L-1006-063, L-1006-064 (Pages). Status: closed 2026-10-06: live on GitHub Pages https://bsturrock.github.io/football/ (Pages from main, root); user tested: works (L-1006-068)
- **B-002** [physics] If cannon-es fails to load, physics silently turns off: main.js:77 swallows the import error (`() => {}`), so every tackle and fall skips the ragdoll with no message; expected a visible console error and HUD note. Repro: block cdn.jsdelivr.net, load the page, run a play: no ragdolls, no error. Where: src/main.js:75-77. Trace: -. Size: S. Kind: bug. Source: PM code review 2026-10-06 (L-1006-067). Status: done, merged 8b087c1
- **B-003** [core] Latent state leak: place() does not reset slip, grip, fire or fireDelay between plays; a stale slip or grip can carry into the next snap (fire/fireDelay are re-set at snap, so harden only). Expected: place() resets all four. Repro: read state.js:43 against writers tackling.js:23,43,58 (grip), tackling.js:105-106 (slip), input.js:55-56 (fire, fireDelay). Where: src/state.js:42-45. Trace: -. Size: S. Kind: bug. Source: PM code review 2026-10-06 (L-1006-067). Status: done, merged 8b087c1
- **B-004** [core] Dead code and loose imports, no behaviour change: o.scripted written never read (input.js:65 and state.js:78, remove both), DEF_CALLS.slant and fastLB unread (playbook.js:6-10), unused blitzer arg in assignFits (defense.js:67), unused hit import shadowed by local hit (tackling.js:2/35), global CANNON at tackling.js:116 (import or note it), unused inp in tackleUpdate (tackling.js:69), extra args to steer/steerVel (movement.js:8,30; offense.js:31,109). Expected: removed or wired. Where: those lines. Trace: -. Size: S. Kind: cleanup. Source: PM code review 2026-10-06 (L-1006-067). Status: done, merged 8b087c1
