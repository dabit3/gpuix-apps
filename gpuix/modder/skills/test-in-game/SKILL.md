---
name: test-in-game
description: Launch the game with the mod, tail the framework log for errors, capture a screenshot, iterate until clean.
---

# test-in-game

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## Run
```sh
modder test ./game                 # headless: real engine + loader, 6 s of autopilot, screenshot PNG
grovekeep -p .modder/game/profile  # play it in a Ghostty split
```
Pass criteria: the mod loads, the log has no errors, and the screenshot shows the feature (projectiles on screen). Debug console: append `give <weapon>`, `spawn <enemy>` or `reload` to `<profile>/console.in`; the running game picks it up. Rebuilds hot-reload into a running game.
