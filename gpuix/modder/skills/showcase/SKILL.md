---
name: showcase
description: Record a short capture of the mod in game and export MP4 for X.
---

# showcase

## Scope and rules (read first)
- Single-player or officially mod-supported games only. Never touch anti-cheat, online/multiplayer code, DRM or license checks. Refuse games whose EULA forbids modding.
- Prefer the official or community-standard mod framework over binary patching. Decompile only to read code locally; never redistribute decompiled code.
- Mods ship as separate files loaded by the framework. Never modify or redistribute original game files.
- `modder` never writes into the game folder without `--yes` (enforced by `src/guard.ts`, covered by `tests/workbench.test.ts`).

## How
Record the Ghostty window (`screencapture -v` or ffmpeg avfoundation), crop to the window, scale with lanczos to 1920x1080, 60 fps CFR, H.264 yuv420p, `-movflags +faststart`. This repo's demo is `media/demo.mp4`. The original prompt asked for drawtext title cards; the requester wants these demos without labels, so none are added.
