# devin-terminal

The Devin web app (app.devin.ai), rebuilt in React and painted by [GPUIX](https://github.com/remorses/gpuix) (GPUI / Metal), running **inside Ghostty** as a CLI, `devin-tui`. Frames go to the terminal over the **Kitty Graphics protocol**. It talks to the **real Devin API**: your sessions, their live status, the real conversation, and new sessions you start from the terminal are real Devin runs. Light and dark themes, split it into panes, zoom a split, or open the same React tree as a native macOS window.

![devin-tui in Ghostty: a live session on the left, a second instance in light mode on the right](media/screenshot.png)

Demo video: [`media/demo.mp4`](media/demo.mp4), real time and real input, no overlays. Ghostty (`theme = GitHub Dark High Contrast`) opens on the prompt, `devin-tui` loads the account's real sessions sorted by activity (child sessions stay collapsed under their parents) with the API key read from the macOS Keychain, ⌘K search opens the real `TryDevin.ai` session, then the sidebar opens the live Automations list and Customize, where a playbook expands and stays open through a light/dark toggle. Settings → Devin API shows the key stored in the Keychain and runs Test connection against the API. A new prompt starts a real Devin session whose reply streams in, Cmd-D splits the pane and `devin-tui -t light -s duo` opens a second instance in light mode, the divider is dragged so both reflow, the split is zoomed, and Ctrl-C returns each pane to its prompt.

## Run

```bash
bun install
bun link                 # puts `devin-tui` on your PATH (package.json "bin")
export DEVIN_API_KEY=... # a Devin personal access token (Settings > Devin API > PATs)
export DEVIN_ORG_ID=org-...
devin-tui                # live mode, inside Ghostty or kitty
devin-tui -s dynatrace   # open the first session matching "dynatrace"
devin-tui -m fast -r acme/web "Fix the flaky checkout test"   # start a real session
devin-tui -t light       # light theme (default: follow Ghostty's theme)
devin-tui --demo         # scripted demo data, no API key needed
devin-tui --window       # same app in a native macOS window
bun test && bun run typecheck
```

```
devin-tui [options] [prompt]
  prompt              start a new Devin session with this prompt
  -s, --session <q>   open the first session matching <q> (title or repo)
  -m, --mode <mode>   agent mode for new sessions: normal | fast | ultra
  -r, --repo <repo>   repository for new sessions (owner/name)
  -t, --theme <name>  light | dark | auto (default: follow Ghostty's theme)
      --demo          use scripted demo data instead of the Devin API
  -w, --window        open a native window instead of painting into the terminal
  -h, --help          show this help
```

Credentials come from `DEVIN_API_KEY` + `DEVIN_ORG_ID`, or from `~/.config/devin-tui/config.json` (`{"apiKey": "...", "orgId": "org-..."}`, keep it `chmod 600`). Without them the app falls back to scripted demo data and says "Demo data" in the sidebar footer; live mode says "Live · api.devin.ai".

Don't pipe anything into `devin-tui`: GPUIX 0.11.0 treats a stdin pipe as the automation protocol, and terminal mode needs the TTY. Ctrl-C quits and restores the prompt.

Zoom (75–200%, remembered between launches): ⌘+ / ⌘− / ⌘0 or ⌃+ / ⌃− / ⌃0. Ghostty keeps ⌘+ / ⌘− for its own font size, so in terminal mode `devin-tui` watches the terminal's cell size and steps its zoom with Ghostty's font. The zoom runtime is wired with a `/** @jsxImportSource #zoom */` pragma plus the `#zoom/*` import in `package.json`, so it works from any working directory (Bun only applies `tsconfig.json` when launched from this folder).

## Live mode (Devin API v3)

`src/api.ts` is a small client for the organization endpoints, authenticated with a bearer token:

| UI | Endpoint |
|---|---|
| Sidebar: up to 20 pages (2,000 sessions) once at launch (cursor pagination), then the newest page every 9 s; sorted by `updated_at`, "Load more…" shows 40 more | `GET /v3/organizations/{org}/sessions?first=100&after=…` |
| Open session: status, ACUs, PRs (polled every 3 s) | `GET /v3/organizations/{org}/sessions/{id}` |
| Transcript (polled every 3 s, cursor pagination) | `GET /v3/organizations/{org}/sessions/{id}/messages` |
| Composer on the home view | `POST /v3/organizations/{org}/sessions` (`prompt`, `devin_mode`, `repos`, tag `devin-tui`) |
| Composer inside a session | `POST /v3/organizations/{org}/sessions/{id}/messages` |

- Sessions nest under their `parent_session_id`, like the web app, collapsed until you click the chevron. The API lists by creation time, so the client sorts by last activity.
- `status` + `status_detail` map to the dots and the footer line: working (blue, pulsing), waiting for user / approval (orange, "Action required"), finished, suspended ("Devin went to sleep"), error.
- The gap between messages becomes a "Worked for 46s" row, and a running session ends with a live "Working for …" timer. New Devin messages type in as they arrive.
- The web app's inline markup is cleaned up: `<ref_file>` / `<ref_snippet>` become `file.ts:3-9`, `ATTACHMENT:{...}` payloads become links.
- The right panel opens on **Computer**: Devin's screen, as far as the public API exposes it. The v3 API has no live screen, VNC or browser stream, but `GET /sessions/{id}/attachments` lists every screenshot and recording Devin posts. The panel shows the newest one large, polls while the session runs and jumps to new posts, has ←/→ and a recent list to step back, and "Open" downloads the original (full image or recording) into the cache and opens it in the default macOS viewer. app.devin.ai attachment links need a web-app login and the presigned S3 URL is served as a download, so neither is opened directly. Images download through the presigned redirect from `GET /attachments/{uuid}/{name}`; recordings show a poster frame that `ffmpeg` grabs straight from the presigned URL (without ffmpeg they show a placeholder). Previews are cached in `~/.cache/devin-tui/attachments/`. The panel widens to 520 px on windows ≥ 1360 px.
- The **Session** tab shows the session's details (status, mode, ACUs, link, child sessions), plus one tab per PR with its state and an "Open on GitHub" button.
- The messages API returns the conversation, not Devin's shell/editor/browser steps, so live sessions show messages and work durations. The scripted demo data (`--demo`) still shows the shell, diff, browser, plan and PR cards.

## API key (Settings → Devin API)

You don't need environment variables. Open Settings (gear, bottom left) → **Devin API**, enter the organization ID and paste a personal access token. **Test** checks it against the API, and **Save** only stores a token that passes. The app reconnects straight away, so it switches between demo and live mode without a restart.

- **Storage:** the macOS Keychain (generic password, service `devin-tui`, account `default`). The token is written through `security -i` on stdin, so it never appears in a process list. `~/.config/devin-tui/config.json` keeps only the org ID. Without a Keychain (Linux, or if the write fails) the token goes into that file instead, created `0600` in a `0700` folder.
- **Lookup order:** `DEVIN_API_KEY` / `DEVIN_ORG_ID` / `DEVIN_API_BASE` environment variables, then the Keychain, then the file. The page tells you which one is active, and warns when an environment variable overrides the saved key.
- **Display:** the field is masked while you type (the eye button shows it). After saving, the page shows only the first and last four characters.
- **Remove** (click twice) deletes the Keychain item and strips the token from the file.

## Pages and menus

Everything in the sidebar, the composer and the session header does something. Pages backed by the API work for real. Pages the public API doesn't cover open the matching app.devin.ai page in your browser instead of faking it.

| Control | What it does | Endpoint |
|---|---|---|
| Automations | List, pause/resume, create (name, prompt, schedule preset), delete (click twice), browse templates | `GET/POST /automations`, `PATCH/DELETE /automations/{id}`, `GET /automations/templates` |
| Customize → Playbooks | Search, read, create, "Use in new session" (attaches it to the composer) | `GET/POST /playbooks`, `playbook_id` on create |
| Customize → Knowledge | Search, read, enable/disable, create notes | `GET/POST /knowledge/notes`, `PUT /knowledge/notes/{id}` |
| Security | PR totals (open / merged / closed) from your sessions, and secret names (never values) | `GET /secrets` |
| Review | Start a review session for a PR URL or repo; lists your sessions' open PRs | `POST /sessions` |
| Bell | Sessions that are waiting for you, finished, or failed since you last looked; "Mark all read" | derived from sessions |
| Session ⋯ | Copy link, open in web app, open PR, start a linked session, rename (local only, the API has no rename), archive, stop | `POST /sessions/{id}/archive`, `DELETE /sessions/{id}` |
| Composer + / / | Attach a repo, a playbook or a linked session; slash commands (`/new`, `/ask`, `/theme`, `/automate`, `/review`, `/settings`) | `repos`, `playbook_id`, `session_links` on create |
| Agent / Ask | Ask starts a session told to answer only, tagged `ask` | `POST /sessions` |
| Mode picker | Fusion, Ultra, Normal, Lite (`devin_mode`) | |
| Settings | Preferences (theme, default mode, default repo, zoom, saved locally in `~/.config/devin-tui/prefs.json`), Devin API, keyboard shortcuts; everything else opens app.devin.ai | |
| Sidebar icon, More, Help | Hide/show the sidebar; DeepWiki, Oncall, docs, app.devin.ai | |

The mic and voice buttons were removed: GPUIX has no audio capture in a terminal app.

### Parity pass 3 (all API-backed)

- **Archived sessions stay hidden.** The session list asks for `is_archived=false` (the API returns archived sessions by default, about half of this org's), and every refresh drops sessions archived elsewhere after launch, except the one you have open.
- **All sessions** (More → All sessions, or the Sessions ⋯ menu): the web app's sessions table, with search, Active / Waiting on you / With PRs filters, state labels ("PR is ready", "Waiting on you"), repo, PR badges and time. **Archived** lists the 300 most recently archived sessions with **Unarchive** (`POST /sessions/{id}/unarchive`), which puts the session back in the sidebar.
- **Session tab:** editable **tags** (`PUT /sessions/{id}/tags`) and **Insights** (`GET /sessions/{id}/insights`): category, size, message counts, tools, issues, action items and the suggested prompt, with **Analyze** (`POST …/insights/generate`) when there is no analysis yet.
- **PR tabs:** Devin Review status for the PR (`GET /pr-reviews?pr_url=`), with **Run review** / **Re-run** (`POST /pr-reviews`) on open PRs.
- **Usage** (More → Usage): sessions created, sessions with merged PRs, PR created/merged/open/closed, merge rate and where sessions start, for 7 / 30 / 90 days (`/metrics/sessions`, `/metrics/prs`; daily ACUs from `/consumption/daily` when it reports any).
- **Repositories** (More → Repositories): connected repos with language and DeepWiki/search indexing state; **New session** preselects that repo in the composer.
- **Environment** (More → Environment): snapshot builds with status, trigger and duration; click one to read the last 80 lines of its build log in the app (JSONL from the presigned log URL, with an Errors filter), plus the org and repo blueprints. **Rebuild** starts a manual build.
- **Security** now lists code-scan findings (`/code-scans/findings`) by severity; clicking one opens its fix PR or session.

## Design

Laid out after the current web app: org header with search/notifications, New session (⇧⌘O), Automations, Security, Review, Customize, More, then Sessions with search (⌘K), nested sessions and "Load more…". The home view is the Devin mark with the Agent/Ask toggle over the big composer (+, slash commands, settings, repository, mode, mic, voice, split send button). Sessions get a branch/title/PR-count header with a status chip, the transcript, the status line and the composer. Inter is bundled (`assets/fonts`) and registered with `registerFont()`.

Two palettes live in `src/theme.ts`. Dark uses Ghostty's GitHub Dark High Contrast background (`#0a0c10`) so the GUI blends into the terminal. Light is the web app's white. `auto` (the default) reads `~/.config/ghostty/config` and picks light for a light Ghostty theme. The sun/moon button (or ⇧⌘L) flips it at runtime.

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

## Splits and reflow

The app follows the terminal's size through `useWindowSize()`:

- **≥ 1080 px**: full layout (288 px sidebar, transcript, 400 px right panel).
- **600–1080 px** (a half split): 232 px sidebar, no right panel, trimmed header.
- **< 600 px** (a narrow split): transcript and composer only.

Splitting with Cmd-D, dragging the divider, or zooming a split (Cmd-Shift-Enter) reflows it live, and each pane is its own independent app.

Env flags: `GPUIX_WINDOW=1` (same as `--window`), `GPUIX_BACKGROUND=1` (don't steal focus), `GPUIX_DEBUG_OVERLAY=1` (GPUI frame-time overlay), `DEVIN_TUI_NAME` (name in the org header).

## GPUIX features used

`render(..., { terminal: true })`, `isTerminal()`, `registerFont()`, `<markdown>`, `<code>`, `<diff>`, `<textarea>`, `<input>`, `<svg>` (Lucide icons and the Devin mark as text imports), `<motion.div>` native animations, headless `Select`, `<virtual-list>` (`followTail`), focus APIs (`focusElement`, `blur`, `getFocusedElementId`, `tabIndex`, `autoFocus`), window `onKeyDown`, `debugFrameOverlay`, the native test renderer and the automation client.

## Test

- `api.test.ts`: the client hits the right v3 URLs with the bearer token, follows message pages, sends the right create/message bodies and surfaces HTTP errors; status mapping, message cleanup, work-gap rows, config loading (env beats saved) and theme resolution.
- `keystore.test.ts` (fake `security` runner): saving goes to the Keychain and leaves only the org ID in a `0600` file; env vars beat the Keychain; Remove clears it; without a Keychain the token lands in the `0600` file and Remove strips it.
- `features.test.tsx`: request shapes for automations, knowledge, archive/stop and create-with-playbook; then, in the GPUIX test renderer against a fake API: Automations (list, pause, create, delete), Security (PR stats, secret names), Customize (toggle a note, use a playbook in a new session), the bell, session ⋯ → Archive, and Settings → Devin API (masked entry, verify, save).
- `app.test.tsx` (GPUIX native test renderer + automation client):
  1. Demo data: switching sessions, New session + Ultra + prompt creates a streaming session that finishes with all PR checks green, ↑/↓, ⌘K search and Esc.
  2. 700 px wide (a half split) with the CLI's prompt: compact layout, no right panel, sidebar still switches sessions.
  3. Live mode against a fake `DevinApi`: sessions load and nest, opening one polls its messages, a message added server-side appears on the next poll, the composer calls `sendMessage`, New session calls `createSession`, and the theme toggle switches to light and back.

```
bun test   →  9 pass  0 fail  (4 files)
bun run typecheck
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
9. **`<markdown>` text is invisible to automation.** `getAllText()` and `textContent()` don't include `<markdown>` content in 0.11.0 (the README says `getAllText()` only sees `<text>` nodes), so the live-mode test asserts that each message element appears instead of reading its text.
