---
name: write-mod
description: Generate the mod project from a template, bundle it and place it in the profile mods folder.
---

# write-mod

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## Run
```sh
modder new ./game --template sword --name Emberblade --color "#39c5cf"
modder build ./game
```
Templates (`src/templates.ts`) mirror the reference walkthroughs: `sword` (Terraria + tModLoader: weapon with custom projectile and generated sprite), `hud` (Unity Mono + BepInEx: hotkey HUD overlay of player stats), `unit` (AoE2 DE: data-mod enemy variant). The build is `Bun.build` → `<profile>/mods/<id>/mod.js` + `manifest.json`. `modder install ./game --yes` copies it into the game folder; without `--yes` it refuses.
