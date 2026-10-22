# tokscope

A token-efficiency audit for agent transcripts, rendered inside the terminal with
[GPUIX](https://github.com/remorses/gpuix). Point it at Claude Code, Codex CLI or
Devin CLI transcripts, or the bundled sample logs. It shows where the money goes by
prompt segment, what the cache saved and where it broke, which tool results cost the
most to carry, and a ranked list of fixes. It writes the whole thing as `AUDIT.md`.

![tokscope in Ghostty](media/demo.mp4)

## Run

Needs [Bun](https://bun.sh) and Ghostty or kitty (GPUIX terminal mode only paints in
those two; tmux and the VS Code/Zed terminals stay blank).

```sh
cd gpuix/tokscope
bun install
bun link                       # puts `tokscope` on your PATH

tokscope                       # ~/.claude/projects if it exists, else sample/
tokscope ~/.claude/projects
tokscope sample/
tokscope --audit sample/       # headless: write AUDIT.md, print a summary, no UI
```

Watch a transcript grow, in a Ghostty split (`Cmd-D`):

```sh
tokscope sample/ live/         # left pane
bun replay                     # right pane: appends a sample session to ./live line by line
```

`bun replay [transcript.jsonl] [dest-dir] [--speed 2]` replays any transcript. tokscope
polls its inputs every 500 ms, re-parses only files whose size or mtime changed, and
follows the newest session (`f` toggles follow).

Options: `-o/--out` report path, `-p/--prices` price sheet, `--no-watch`, `-h/--help`.

Keys: `1`-`4` views · `j`/`k` or arrows sessions · `a` all sessions · `space` toggle a
fix · `x` all fixes · `w` write AUDIT.md · `f` follow · `Esc` · `Ctrl-C` quit. Mouse:
hover the request timeline and segment rows, click sessions, offenders and fixes,
scroll the lists and the report.

Checks:

```sh
bun test            # pure logic + GPUIX test renderer
bun run typecheck
bun sample          # regenerate sample/ (deterministic)
```

## Views

- **Overview**: cost, cost per task, cache hit rate, input/output, projected cost with
  the selected fixes. "Where the money goes" splits cost into system prompt, tool
  schemas, history, retrieved context (memory/CLAUDE.md/reminders), tool results and
  output. "Every request" is one bar per API call: height is tokens sent, colors are
  segments, the strip below is cache read/write, red marks a cache break. Hover a bar to
  see what that turn carried and what it cost.
- **Offenders**: tool results ranked by what they cost to carry (size × turns resent,
  billed at the cache rates actually paid), with a preview of the content, plus repeated
  identical tool calls and cache breaks with their likely cause.
- **Fixes**: the audit findings, each with its flag name, estimated savings and
  ship/flag status. Toggle them to see the projected cost per task.
- **AUDIT.md**: the report, rendered with `<markdown>`; `w` writes it to disk.

## Design

Monochrome and flat, after a dark devin.ai: neutral grays on the Ghostty theme's
background, 1 px hairlines instead of cards, regular-weight numbers, mono uppercase
micro-labels, and color only where it means something (green for projected savings,
red for cache breaks). Segments are a gray ramp: the cached prefix sits dark at the
bottom of each bar and what the turn added is bright. Type is Geist and Geist Mono
from the [`geist`](https://www.npmjs.com/package/geist) package (SIL OFL), registered
at startup with `registerFont`; `<code>` and `<markdown>` share a monochrome theme.

## Supported harnesses

The format is detected per file, so one run can mix all three.

| Harness | Where | Per-request usage | Notes |
|---|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | assistant `message.usage` (input, cache write, cache read, output) | Sub-agents from `subagents/`; system prompt and tool schemas from `api-request-shape` lines when present |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `token_usage_record` per response (falls back to `token_count.last_token_usage`) | `input_tokens` already includes `cached_input_tokens` and `cache_write_input_tokens`. System prompt size from `session_meta.base_instructions`; tool schemas aren't logged, so they get the unexplained rest of the prefix. Encrypted reasoning is sized from its ciphertext |
| Devin CLI | `devin --export <file>.json -- <task>` (ATIF-v1.7); `~/.local/share/devin/exports` is scanned if it exists | step `metrics`: `prompt_tokens` (includes `cached_tokens`), `completion_tokens`, `extra.cache_creation_input_tokens` | Any ATIF trajectory works (Harbor agents too). System prompt from leading system steps, tool schemas from `agent.tool_definitions`, embedded `subagent_trajectories` become sub-agent sessions |

The Codex parser was checked against a real Codex CLI 0.163 rollout. The Devin parser follows
the ATIF RFC and the field names in the Devin CLI 3000.11 binary, but hasn't been run on a
real `devin --export` file yet (the CLI needs a signed-in account). `sample/codex` and
`sample/devin` are synthetic (`sample/generate-multi.ts`). GPT prices in `prices.json` are
placeholders like the rest of the sheet.

## How the numbers are made

- Claude Code writes one JSONL line per content block. tokscope dedupes assistant blocks
  by `message.id`, links tool results to their calls, and follows sub-agent transcripts
  (`subagents/`) as separate sessions under their parent.
- Billed usage (`input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`,
  `output_tokens`) comes straight from the transcript. The split of input into segments
  is estimated from the content (~3.7 chars/token) and scaled so each request adds up to
  its billed input.
- Cache billing is positional: the prompt is laid out system → tools → history →
  context → tool results, the first `cache_read` tokens are billed as reads, the next
  `cache_creation` tokens as writes, the rest as uncached input.
- A cache break is a request whose cache read drops below half of the previous
  request's prompt in the same chain. The cause is the request shape changing, an idle
  gap past the cache TTL, or a mutated prefix.
- Prices live in [`prices.json`](prices.json) (USD per 1M tokens, matched by model-id
  substring). They are assumptions to edit, not a verified copy of anyone's price sheet.
- Fix savings are **projections** from replaying the recorded transcripts with each
  change applied. Overlapping fixes combine multiplicatively, not additively.

## Adapted from the original prompt

The prompt ("Agent-harness token-efficiency audit", rebuild prompt 11) is written for an
agent working inside a harness repo. tokscope is the measuring half of it, run from the
outside on the transcripts a harness already writes.

| Prompt | tokscope |
|---|---|
| Phase 1: map request assembly, diagram it in AUDIT.md | Request-assembly diagram in AUDIT.md from the observed prompt layout |
| Phase 1: per-request tokens by segment, cache hits/misses, model; per-task turns and cost | Parsed from transcripts, segment split estimated (above) |
| Phase 2: rank opportunities with $ impact | Seven checks: oversized tool results, stale tool results, repeated identical calls, unstable prefix / cache breaks, idle gaps past TTL, unused tool schemas, sub-agents on expensive models |
| Phase 3: implement, behind flags | Out of scope: tokscope doesn't own the harness. Each fix carries the flag name it would ship behind and a ship (mechanical) / flag (behavior-changing) label |
| Phase 4: AUDIT.md | `w` or `--audit` |
| Price sheet in a config file | `prices.json`, `--prices` |

Cut, and said so in AUDIT.md: the eval set, the 3× baseline runs, confidence intervals
and quality deltas. tokscope can't run tasks, so it can't show "no significant quality
drop". Its savings are projections to confirm with an eval, which means the prompt's
second acceptance criterion is not met here. Also cut: latency, retrieval chunk/top-k
analysis (no retrieval in these transcripts beyond injected context).

The bundled `sample/` is synthetic (`sample/generate.ts`, seeded): six tasks across three
fake projects plus one sub-agent, with planted problems (a cache-busting timestamp, huge
file reads, a retry loop, an idle gap, a sub-agent dumping raw files). It follows the
current Claude Code transcript format. tokscope was also run on three real Claude Code
transcripts on this machine (12 requests, $0.50 estimated, 82.9 % cache hit). Those
aren't committed because they contain the provider's system prompt.

## GPUIX findings (0.11.0, terminal mode, macOS VM)

- **Painted children block hover.** A `div` with a background fill swallows hover for
  the element behind it, so `onMouseEnter` on a bar made of colored segment divs never
  fired. `pointerEvents: 'none'` on the fills fixed it (covered by a test-renderer test).
- `useGpuix()` returns `{ renderer }`, not the renderer. Passing the context object
  to a font loader fails silently (no `registerFont` on it) and every `fontFamily`
  quietly falls back to the system font, including mono. `registerFont` needs each
  weight as its own file; text that named the family repaints once it's registered.
- `KeyEvent.modifiers` is `{ shift, ctrl, alt, cmd }`. Import `KeyEvent` from
  `@gpuix/react` instead of hand-typing the handler.
- Test renderer: mount with `createTestRoot(...).render(...)` then `renderer.flush()`.
  `nativeSimulateKeystrokes` takes an element id first (`findByTestId(...).id`); a bare
  string fails with "Failed to convert napi value String into rust type f64".
  `nativeSimulateMouseMove` + `getElementBounds` work for hover tests.
- Running the native test renderer opens a real window that can take focus from
  Ghostty. Close it before driving Ghostty by hand.
- The held `[gpuix] created native window` lines print under the prompt after exit.
  The `RUST_LOG=error` shebang doesn't cover them because they come from
  `console.log`, so the CLI filters `[gpuix]` lines.
- Dragging across text inside the app selects it, so a drag that misses Ghostty's
  split divider by a few pixels highlights text in the dashboard instead.
- Don't let stdin be a pipe: the CLI refuses non-TTY stdin, since GPUIX switches to its
  automation protocol.
- Layout reflows cleanly at every split width. Below 1000 px the sidebar becomes a
  `‹ ›` session switcher and the input/output cards drop out.
- Performance: Apple Paravirtual Metal on a VM, so slower than a real Mac. No fps was
  instrumented. Hover, tab switches and live updates kept up during the 60 fps screen
  capture of the demo with no visible lag. Parsing the 1.3 MB sample takes well under a
  second; live updates re-parse only changed files.

## Layout

```
bin/tokscope.ts      CLI
src/parse.ts         Claude Code JSONL → sessions, requests, tool calls
src/analyze.ts       segment attribution, cache billing, cache breaks, offenders
src/audit.ts         findings, projected savings, AUDIT.md
src/load.ts          file discovery + mtime/size cache for live reload
src/app.tsx          the dashboard
scripts/replay.ts    replay a transcript into a directory, for the live demo
sample/              synthetic transcripts + generator
media/demo.mp4       demo recording
```
