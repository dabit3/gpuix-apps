---
name: setup-framework
description: Install the recommended loader into a copy or mod profile, never the clean install; verify it loads via its log.
---

# setup-framework

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## Run
The workbench always works in `./.modder/<game>/` (or `-o <dir>`), never inside the game folder. For Grovekeep the "framework" is the official loader: a profile folder with `mods/<id>/manifest.json`, enabled with `grovekeep -p <profile>`.
For other engines `modder recon` prints the install plan (e.g. copy the game, unzip BepInEx into the copy, run once, check `BepInEx/LogOutput.log`). Only install into the real folder when the framework requires it and the user passes `--yes`.
