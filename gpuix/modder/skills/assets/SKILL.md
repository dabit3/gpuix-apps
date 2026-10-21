---
name: assets
description: Generate art that matches the game: sample palette and resolution from existing sprites, then quantize.
---

# assets

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## How it works
`src/assets.ts` reads `assets/sprites.json`, samples the palette and sprite size, and procedurally draws a 12x12 blade in that palette (no external API key needed; this is the truthful local stand-in for an image-generation API). Output is a palette-quantized sprite embedded in the mod and a PNG in the workspace.
To use a generation API instead, put the key in `.env`, generate, then run the same quantize + resize step so the result matches the sampled palette and resolution.
