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

- **B-001** [docs] Live build: the user can play main from any computer via a private claude.ai artifact. Now the game runs only on a local vite port, not reachable off-network; expected a link that works anywhere. Publish index.html + src/*.js as-is (no build step; three r128 cdnjs, cannon-es jsdelivr, Google Fonts all on the artifact allowlist), verify a play runs, republish to the same URL after each main move. Trace: -. Size: S. Kind: tooling. Source: user L-1006-063. Status: open
## Backlog

## Moved

## Done
