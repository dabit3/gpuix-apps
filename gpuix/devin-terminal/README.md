# devin-terminal

A high-fidelity mirror of the Devin web app (app.devin.ai), written in React and painted by [GPUIX](https://github.com/remorses/gpuix) (GPUI / Metal). It runs **inside Ghostty** as a CLI, `devin-tui`, using GPUIX terminal mode: frames go to the terminal over the **Kitty Graphics protocol**. Create GUIs, use them as TUIs: split it into panes, zoom a split, run it over SSH. The same React tree also opens as a normal native macOS window.

![Two Devin mirrors in Ghostty splits (GitHub Dark High Contrast)](media/screenshot.png)

Demo video: [`media/demo.mp4`](media/demo.mp4). Ghostty with `theme = GitHub Dark High Contrast` opens on the prompt, `devin-tui` paints the app in the terminal, Cmd-D splits the pane and a second `devin-tui -m ultra "..."` streams a run beside it, the divider is dragged so both apps reflow, the split is zoomed, Ctrl-C returns to the prompt, then `ssh -t localhost devin-tui -s haptics` runs it over SSH.

## Run

```bash
bun install
bun link                 # puts `devin-tui` on your PATH (package.json "bin")
devin-tui                # terminal mode, inside Ghostty or kitty
devin-tui -s terraform   # open the first session matching "terraform"
devin-tui -m ultra "Add dark mode to the settings page"   # start a new session and stream the run
devin-tui --window       # same app in a native macOS window
devin-tui --help
bun app.tsx [args]       # same thing without bun link
bun run dev              # terminal mode with --hot
bun test                 # GPUIX native test renderer behavior tests
bun run typecheck
```

```
devin-tui [options] [prompt]
  prompt              start a new session with this prompt and stream the run
  -s, --session <q>   open the first session matching <q> (title, repo or branch)
  -m, --mode <mode>   agent mode for new sessions: normal | fast | ultra
  -w, --window        open a native window instead of painting into the terminal
  -h, --help          show this help
```

Don't pipe anything into `devin-tui`: GPUIX 0.11.0 treats a stdin pipe as the automation protocol, and terminal mode needs the TTY. Ctrl-C quits and restores the prompt.

## Ghostty setup used for the demo

```
# ~/.config/ghostty/config
theme = GitHub Dark High Contrast
font-size = 15
window-padding-x = 10
window-padding-y = 8
keybind = super+k=unbind   # let the app own Cmd-K (search) and Cmd-N (new session)
keybind = super+n=unbind
```

The app palette is read from Ghostty's `GitHub Dark High Contrast` theme file (`#0a0c10` background, `#f0f3f6` text, `#71b7ff` blue, `#26cd4d` green, `#39c5cf` cyan accent), so the GUI blends into the terminal around it.

## Splits and reflow

The app follows the terminal's size through `useWindowSize()`:

- **≥ 1080 px**: full layout (260 px sidebar, transcript, optional 400 px right panel).
- **600–1080 px** (a half split): 216 px compact sidebar, the right panel is hidden, and the header drops branch/share/panel buttons.
- **< 600 px** (a narrow split): transcript and composer only.

Splitting with Cmd-D, dragging the divider, or zooming a split (Cmd-Shift-Enter) reflows it live, and each pane is its own independent app.

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

`app.test.tsx` renders the real app in the GPUIX native test renderer and asserts behavior. Test 1: switching sessions changes the header and status, New session + Ultra mode + typed prompt creates a new sidebar entry with the right title and mode, the simulated run reaches "Working", then "Finished" with all PR checks passing and the running counter drops, ↓/↑ move the selection, ⌘K focuses search, typed keystrokes filter the list and Esc restores it. It also writes `test-screenshots/streaming.png`. Test 2 renders at 700 px wide (a Ghostty half split) with the CLI's `initialPrompt` and `ultra` mode: the prompt becomes a streaming Ultra session, the right panel is gone, and the compact sidebar still switches sessions.

```
(pass) devin-terminal > switches sessions, changes agent mode, and streams a new session to a finished PR
(pass) devin-terminal > reflows into a narrow split and starts the CLI prompt as a new session
 2 pass  0 fail  20 expect() calls
```

## Performance (Apple Paravirtual Metal VM, not real Apple Silicon)

| Metric | Value |
|---|---|
| Process start → first mount (`[gpuix] mount complete`) | ~0.3 s (warm), native window |
| Draw time, GPUI debug overlay (idle, full transcript + panel) | CUR 5.1 ms, 10% 5.3 ms, 1% 5.4–7.1 ms |
| Worst frame (first paint, includes font/layout warm-up) | ~37 ms |
| RSS (bun + native renderer) | ~177 MB at start, ~195 MB after a streamed run |
| CPU while idle / streaming | ~2–4 % |
| Terminal mode in Ghostty | frames sent via kitty graphics shared memory; clicks and keys respond within a frame or two in a 1442×928 Ghostty window, including two instances side by side |
| Over SSH (`ssh -t localhost devin-tui`) | frames sent inline (zlib + base64); first frame appeared well under 1 s after Enter in the recording, clicks still responsive |

Paravirtual Metal is slower than an M-series GPU, so expect better numbers on real hardware.

## GPUIX findings (v0.11.0, `@gpuix/react` + `@gpuix/native`, macOS arm64, Ghostty 1.x)

1. **Window `onKeyDown` needs a focused element.** With nothing focused, ↑/↓/Esc never reach the `render({ onKeyDown })` handler, in both the native window and terminal mode. Workaround: a root `<div tabIndex={-1} autoFocus onKeyDown>` that forwards to the same handler. ⌘K works either way.
2. **Text color does not inherit.** Every `<text>` sets `color`; otherwise it paints black on the dark theme.
3. **Shadow fields** are `blurRadius` / `spreadRadius` / `offsetX` / `offsetY` (not CSS shorthand); `testId` is not accepted on `motion.div` (put it on a child).
4. **Markdown width.** A `<markdown>` block inside a flex column overflows unless the column has `width: '100%'` and `minWidth: 0`.
5. **Terminal launch logs.** Terminal mode holds stdout/stderr until exit, then dumps native `INFO`/`WARN` logs (e.g. `gpui_macos::text_system` duplicate-font warnings) onto the restored prompt. Workaround: the `app.tsx` shebang sets `RUST_LOG=error` and `[gpuix]` JS logs are filtered unless `GPUIX_VERBOSE=1`.
6. **`simulateInput` is not on the test renderer** in 0.11.0; `simulateKeystrokes('t e r r a f o r m')` works for typing into a focused `<input>`.
7. **Ghostty splits work, tmux doesn't.** Each Ghostty split gets its own kitty-graphics surface, so two GPUIX apps side by side, divider drags and split zoom all reflow cleanly. tmux is unsupported, as the README says.
8. **SSH works** (`ssh -t localhost devin-tui`): the remote app paints and takes clicks; `-t` is required for the TTY.
