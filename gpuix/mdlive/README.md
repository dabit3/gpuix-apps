# mdlive

A live GitHub-flavoured Markdown preview that renders **inside your terminal**. Run `mdlive notes.md` in Ghostty or kitty and a real GPUI surface paints in the pane: crisp proportional type, syntax-highlighted code, tables, images and clickable checkboxes. Edit the file in nvim in the next split and every save re-renders and scrolls to the block you just changed.

It is a [GPUIX](https://github.com/remorses/gpuix) app (React for Zed's GPUI, Metal on macOS) running in GPUIX terminal mode, where frames reach the terminal over the kitty graphics protocol.

![mdlive in a Ghostty split next to nvim](media/screenshot.png)

Demo (real time, real input in Ghostty): [`media/demo.mp4`](media/demo.mp4)

## Features

- **Live reload**: watches the file's directory, so both in-place writes and editor atomic-rename saves (nvim, VS Code) are picked up. "Updated just now" confirms each save.
- **Follow edits**: on each save mdlive diffs the parsed blocks, glides to the first changed block and washes it in blue. Toggle with `f` (a small toast confirms).
- **Changes you can see**: every block you edited this session keeps a thin mark in the margin. With follow off, an off-screen save shows an "Edited below" / "Edited above" pill; click it to glide there.
- **Jump to a section** (`o`): a Spotlight-style palette over the headings with fuzzy matching. Type `roll`, press Enter, and the document glides to Rollout.
- **Links that work**: a link to another `.md` file opens it in place, with a back arrow in the header (or `Backspace`) that returns to the exact scroll position. `#anchor` links scroll to the heading; web links and other files open with the system handler.
- **Smooth motion**: section jumps, find, top/bottom (`g`/`G`) and follow-to-edit all glide with a cubic ease; the app fades in on launch.
- **Reading progress**: the header's bottom hairline fills in blue as you read.
- **Copy code**: hover a code block for Copy, which turns into "Copied". It copies over OSC 52 in the terminal, so it also works over SSH.
- **Image zoom**: click an image to view it full size over a dimmed backdrop; click or `Esc` to close.
- **Shortcuts sheet** (`?`): every key in one overlay, and a one-time "Press ? for shortcuts" hint on launch instead of a permanent row of hints.
- **GFM**: headings, emphasis, blockquotes, lists, tables, fenced code with syntax highlighting (`<code>`), local images (`<img>`, path resolved next to the file), task lists.
- **Task lists you can click**: checkboxes toggle `[ ]` / `[x]` in the source file itself, so nvim sees the change too.
- **Contents sidebar** with the active section highlighted as you scroll. Click to jump, or `[` / `]` for previous/next section. In a narrow split it steps aside, and `t` slides it back in as a drawer over the document.
- **Find in page** (`/`): live match count, `Enter` / `Shift-Enter` to step through matches, `Esc` to close.
- **Reading modes**: a narrow 760 px column or wide full-pane layout (`w`, or `-w` on the command line).
- **Word count and reading time** in the header, next to when the file was last updated.
- **Theme from Ghostty**: the background, text and accents come from the active Ghostty theme file (default `GitHub Dark High Contrast`), so the app blends into the terminal instead of sitting in a box.

## Run it

Requires macOS (arm64), [Bun](https://bun.sh) and a kitty-graphics terminal: **Ghostty** or **kitty**.

```sh
cd gpuix/mdlive
bun install
bun link            # puts `mdlive` on your PATH
mdlive README.md
```

Or without linking: `bun mdlive.tsx examples/notes.md`.

```
usage
  mdlive [file.md] [options]

options
  -w, --wide       wide reading mode (default: narrow column)
      --no-toc     hide the table of contents
      --no-follow  don't scroll to the block you just edited
      --window     open a native macOS window instead of the terminal
  -h, --help       show this help
  -v, --version    print version

keys
  o  jump to section   /  find          [ ]  prev/next section
  j k  scroll          space  page      g G  top/bottom
  w  wide/narrow       t  contents      f  follow edits
  ⌫  back              ?  all shortcuts ^C  quit
```

The split workflow from the demo: start `mdlive notes.md`, press **Cmd-D** in Ghostty, run `nvim notes.md` in the new pane, and save with `:w`. Note that Ghostty uses the first click in an unfocused split to focus it, so a click on mdlive from the nvim pane focuses it and the second click acts.

Ghostty config used for the demo (`~/.config/ghostty/config`):

```
theme = GitHub Dark High Contrast
font-size = 16
window-padding-x = 14
window-padding-y = 10
```

## Tests

```sh
bun test           # 11 tests, GPU test renderer (@gpuix/react/testing)
bun run typecheck
```

The tests mount the real `<App>` with `createTestRoot` and drive it with native simulated input:

- Markdown parsing: blocks, headings, code language, image paths, word count, reading time, changed-block detection.
- CLI argument parsing, `--help`, unknown options.
- Live reload: an atomic rename of a temp file over the watched file shows the new heading, a higher word count and "Updated just now".
- Clicking a contents entry scrolls the document to that section; `]` / `[` step through sections.
- Find: typing `budget` reports the match count, `Enter` advances, a nonsense query shows "No results".
- Wide/narrow mode changes the column width; a narrow root hides the sidebar.
- Clicking a task checkbox rewrites `[ ]` to `[x]` in the file on disk, and back.
- `o` opens the jump palette; fuzzy typing filters headings and `Enter` scrolls to the section.
- Links: a `.md` link opens the file in place with a Back button, Back returns; anchors, web URLs and missing files are classified correctly; OSC 52 encoding and fuzzy scoring.
- With follow off, an off-screen save marks the changed block and shows an "Edited below" pill that scrolls there.
- `?` shows the shortcuts sheet; in a narrow root `t` slides in the contents drawer and a row click jumps.

`examples/notes.md`, `examples/replay.md` (the linked write-up) + `examples/sync-diagram.png` are the fixture (the PNG is drawn by `tools/make-diagram.swift`). `tools/input.swift` is the CGEvent helper used to drive Ghostty with real keystrokes, clicks, drags and scrolls when recording.

## GPUIX features used

Terminal mode (`render(..., { terminal: true })`, `isTerminal()`), `<markdown>`, `<code>` with a custom syntax theme, `<img>` sized to the column, `<svg source>`, `useTextSearch` + `findRanges`, a single-owner scroll container with `renderer.scrollTo` / `getScrollOffset` and element bounds for section tracking, `onLayout` for responsive reflow, global `onKeyDown`, `motion.div` native animations (fade-in, palette, sheet, drawer, pill), `<markdown onLinkClick>`, OSC 52 clipboard, `<input onSubmit>`, `GpuixTheme`, and the `@gpuix/react/testing` GPU test renderer.

## Performance (Apple Paravirtual GPU on a macOS VM)

- Memory: about 136 MB RSS for the UI process plus about 19 MB for the small launcher process (measured with `ps` while showing the 310-word fixture in a 1440x900 Ghostty window).
- Startup: the first frame paints in the terminal about 1 s after pressing Enter (Bun start, GPUI init, font load, first parse).
- Re-render on save is effectively instant for this document size: parsing is a single pass over lines and unchanged blocks keep their React keys.
- Full-pane frames go through shared memory locally, so scrolling and split resizes keep up on this paravirtual GPU, though a resize drag shows a brief stale frame at the old size before the new one lands.

## GPUIX findings (0.11.0)

1. **Native log lines land in the shell after exit.** In terminal mode GPUIX holds stderr and replays it when the app quits, and the native logger prints `INFO gpui_terminal::kitty sending frames through shared memory` and several `WARN gpui_macos::text_system skipping duplicate font ".SFNS-..."` lines on every start. `RUST_LOG=error` does not silence them. Repro: any `render(<App/>, { terminal: true })`, Ctrl-C, and the lines appear above the prompt. Workaround: `mdlive` re-spawns itself as a child with stderr redirected to a temp log, prints the log only if the child fails, and deletes it.
2. **`useTextSearch` doesn't know about matches outside one text node.** When the searchable text is spread over many blocks (markdown + code + tasks), `total` stays 0 unless you compute the matches yourself (`findRanges` per block) and pass `matches: { total, indexOffset }`.
3. **Nested vertical scrolling isn't supported**, so the document is one scroll owner and the contents sidebar is a plain column; long TOCs would need the sidebar to be the only scroller.
4. **Text colour doesn't inherit.** Every `<text>` needs an explicit `color`, including inside rows that already set a colour.
5. **`GpuixTheme['syntax']` rejects a plain object literal** (`Types of property 'constructor' are incompatible`) and needs a cast.
6. **No `letterSpacing` in `StyleDesc`**, so small-caps section labels can't be tracked out.
7. **Test renderer needs pumping.** After `nativeSimulateClick` / key events in `@gpuix/react/testing`, state-driven assertions only settle after `renderer.flush()` + `renderer.dispatchNativeEvents()` in the polling loop.
8. **No VS Code integrated terminal.** Tried with VS Code 1.143.0 from `brew install --cask visual-studio-code`: `mdlive notes.md` in the integrated terminal starts (the tab title switches to `bun`) but the panel stays blank, because xterm.js's image addon speaks Sixel and the iTerm protocol, not the kitty graphics protocol that GPUIX 0.11.0 emits. Ctrl-C quits, though zsh then shows a stray `execute: 3u_` line, presumably a keyboard-protocol reset sequence xterm.js does not understand. So the embed demo is Ghostty-only; the README's kitty/Ghostty support list is accurate.
9. **Terminal mode reports letter keys as `space`.** In Ghostty, pressing `w` delivers `onKeyDown` with `key: "space"` and `keyChar: "w"` (same for every printable letter), while the native window reports `key: "w"`. An app that switches on `e.key` treats every letter as a page-down. Repro: `render(<App/>, { terminal: true, onKeyDown: (e) => console.error(e.key, e.keyChar) })`, press a letter. Workaround: `keyName()` in `src/App.tsx` prefers a printable `keyChar`. Also, a focused root `div` with its own `onKeyDown` gets the same event as the global `render({ onKeyDown })`, so a key could be handled twice; mdlive now handles keys in one place only.
10. **`MotionStyle` is narrower than `StyleDesc`.** `marginTop`/`marginBottom` aren't animatable (animate `top` on a relatively positioned wrapper instead), `motion.div` doesn't accept `testId`, and `cursor` has no `zoom-in`.
11. **Enter on a focused `<input>` doesn't reach the global key handler in terminal mode.** It only fires the input's `onSubmit`, so a palette that handles Enter in `render({ onKeyDown })` does nothing in Ghostty while it works in the test renderer. mdlive's palette wires `onSubmit` and the input's own `onKeyDown` as well.
12. **Spreading `useTextSearch().props` after your own `ref` replaces it.** The props carry a ref, so `<div ref={mine} {...search.props}>` leaves `mine` null and anything measuring that element silently falls back. Merge the refs in a callback placed after the spread.
