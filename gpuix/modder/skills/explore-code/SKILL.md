---
name: explore-code
description: Find hook points: scan the official mod API locally, or decompile managed code with ilspycmd into workspace/decomp (gitignored) and index relevant classes.
---

# explore-code

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## Run
```sh
modder hooks ./game     # writes <workspace>/hooks.md
```
For Grovekeep, `src/hooks.ts` scans `engine.ts` for `emit(...)` sites, `modapi.ts` for API methods and `modloader.ts` for console commands, with file:line.
For managed engines the plan is `ilspycmd <Assembly-CSharp.dll> -p -o workspace/decomp`, then grep for player stats, item tables, spawn logic and UI. `workspace/` is gitignored; never commit decompiled output.
