---
name: recon
description: Identify a game install's engine and modding route; writes recon.json with engine, version, runtime, framework, data/save paths and risk notes.
---

# recon

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## Run
```sh
modder recon ./path/to/game          # table
modder recon ./path/to/game --json   # recon.json shape
```
Evidence rules live in `src/recon.ts` (`ADAPTERS`). Each adapter matches files in the install (e.g. `*_Data/Managed/Assembly-CSharp.dll` → Unity Mono → BepInEx 5 + Harmony; `GameAssembly.dll` + `global-metadata.dat` → IL2CPP → BepInEx 6 / MelonLoader; `Paks/*.pak` + `*-Win64-Shipping.exe` → UE4SS).
If any anti-cheat marker is found (EasyAntiCheat, BattlEye, vgk, PunkBuster) recon returns `risk: "refuse"` and the plan is a refusal. Stop there.
