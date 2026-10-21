# Anatomy for coding agents

When a user asks to "show me how a <machine> works" or to build an Anatomy machine, follow `skill/SKILL.md`:

1. `bun src/cli.ts gen "<description>" -o specs/<slug>.json` (built-in designers), or write the spec by hand
   against `schema/machine.schema.json`.
2. `bun src/cli.ts validate specs/<slug>.json` until it prints `ok`.
3. `bun src/cli.ts snap specs/<slug>.json -o /tmp/<slug>.png` and look at the image.
4. Tell the user to run `bun src/cli.ts specs/<slug>.json` in Ghostty or kitty. Edits hot-reload.

Claude Code: copy `skill/` to `~/.claude/skills/anatomy/`. Codex / Devin / others: point the agent at this file.
