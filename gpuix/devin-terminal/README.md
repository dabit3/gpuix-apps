# devin-terminal

A high-fidelity mirror of the Devin web app (app.devin.ai), written in React and painted by [GPUIX](https://github.com/remorses/gpuix) (GPUI / Metal). It runs **inside Ghostty** using GPUIX terminal mode, where frames go to the terminal over the kitty graphics protocol. The same React tree also opens as a normal native macOS window.

![Devin mirror running inside Ghostty](media/screenshot.png)

Demo video (Ghostty first, native window at the end): [`media/demo.mp4`](media/demo.mp4)

## Run

```bash
bun install
bun app.tsx              # terminal mode (run it inside Ghostty or kitty)
bun app.tsx --window     # same app in a native macOS window
bun run dev              # terminal mode with --hot
bun test                 # GPUIX native test renderer behavior test
bun run typecheck
```

Env flags: `GPUIX_WINDOW=1` (same as `--window`), `GPUIX_BACKGROUND=1` (don't steal focus, maps to `focus: false`), `GPUIX_DEBUG_OVERLAY=1` (GPUI frame-time overlay).

## What it shows

- **Sidebar**: New session (⌘N), search (⌘K), 13 sessions across realistic repos grouped into Today / Yesterday / Previous 7 days, each with title, repo, age and a status dot (working / waiting / finished / failed / sleeping). Knowledge, Settings and the user row at the bottom.
- **Transcript**: user prompt bubble, Devin replies rendered with `<markdown>`, collapsible "Worked for Xm" groups with a live timer, shell cards (`<code>` with command, output and exit code), file-edit cards (`<diff>` with line numbers), browser-step cards (a mini page preview), plan checklists and a PR card (title, number, branch, +/− counts, files, checks that turn green one by one).
- **Composer**: `<textarea>` (Enter sends, Shift+Enter for a newline) with a headless Select agent-mode picker (Normal / Fast / Ultra) and a send button. New sessions also get a repository picker.
- **Simulated runs**: sending a prompt from the home view creates a session at the top of the sidebar and Devin streams back a scripted run: intro, plan, `git clone`/`pnpm install` shell steps, `rg`, a diff, tests, a browser verification, a summary, then a PR whose checks complete. Replying to an existing session streams a follow-up. Status dots and the "N running" counter update live. New events fade/slide in with `<motion.div>`.
- **Right panel**: Shell / Editor / Browser / Planner tabs that follow the selected session (last shell output, last diff, browser preview, plan progress). Toggle it from the header.
- **Keyboard**: ⌘K / Ctrl-K focuses search, Esc clears search and closes popups, ↑/↓ move through the (filtered) session list, ⌘N starts a new session.
- `isTerminal()` drops the traffic-light gap in terminal mode; the native window uses a transparent titlebar with traffic lights inset into the sidebar.

## GPUIX features used

`render(..., { terminal: true })`, `isTerminal()`, `<markdown>`, `<code>`, `<diff>`, `<textarea>`, `<input>`, `<svg>` (Lucide icons imported as text), `<motion.div>` native animations, headless `Select` primitives, `<virtual-list>` for the session list and transcript (`followTail`), focus APIs (`focusElement`, `blur`, `getFocusedElementId`, `tabIndex`, `autoFocus`), window `onKeyDown`, `debugFrameOverlay`, the native test renderer (`createTestRoot`, `simulateKeystrokes`, screenshot capture) and the automation client (`connectTest`, `getByTestId(...).click()/fill()`).

## Test

`app.test.tsx` renders the real app in the GPUIX native test renderer and asserts behavior: switching sessions changes the header and status, New session + Ultra mode + typed prompt creates a new sidebar entry with the right title and mode, the simulated run reaches "Working", then "Finished" with all PR checks passing and the running counter drops, ↓/↑ move the selection, ⌘K focuses search, typed keystrokes filter the list and Esc restores it. It also writes `test-screenshots/streaming.png`.

```
(pass) devin-terminal > switches sessions, changes agent mode, and streams a new session to a finished PR
 1 pass  0 fail  15 expect() calls
```

## Performance (Apple Paravirtual Metal VM, not real Apple Silicon)

| Metric | Value |
|---|---|
| Process start → first mount (`[gpuix] mount complete`) | ~0.3 s (warm), native window |
| Draw time, GPUI debug overlay (idle, full transcript + panel) | CUR 5.1 ms, 10% 5.3 ms, 1% 5.4–7.1 ms |
| Worst frame (first paint, includes font/layout warm-up) | ~37 ms |
| RSS (bun + native renderer) | ~177 MB at start, ~195 MB after a streamed run |
| CPU while idle / streaming | ~2–4 % |
| Terminal mode in Ghostty | frames sent via kitty graphics shared memory; interaction feels immediate at this window size (1360×966 terminal), see demo |

Paravirtual Metal is slower than an M-series GPU, so expect better numbers on real hardware.

## GPUIX findings (v0.11.0, `@gpuix/react` + `@gpuix/native`, macOS arm64, Ghostty 1.x)

1. **Window `onKeyDown` needs a focused element.** With nothing focused, ↑/↓/Esc never reach the `render({ onKeyDown })` handler, in both the native window and terminal mode. Workaround: a root `<div tabIndex={-1} autoFocus onKeyDown>` that forwards to the same handler. ⌘K works either way.
2. **Text color does not inherit.** Every `<text>` sets `color`; otherwise it paints black on the dark theme.
3. **Shadow fields** are `blurRadius` / `spreadRadius` / `offsetX` / `offsetY` (not CSS shorthand); `testId` is not accepted on `motion.div` (put it on a child).
4. **Markdown width.** A `<markdown>` block inside a flex column overflows unless the column has `width: '100%'` and `minWidth: 0`.
5. **Terminal launch logs.** Terminal mode prints `gpui_macos::text_system` duplicate-font warnings to stderr before the first frame; harmless but visible in the terminal.
6. **`simulateInput` is not on the test renderer** in 0.11.0; `simulateKeystrokes('t e r r a f o r m')` works for typing into a focused `<input>`.
