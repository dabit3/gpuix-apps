# crawler

A literal web crawler. A procedurally animated spider (two-bone IK legs, tetrapod gait, body sway) crawls over a web page that GPUIX paints **inside Ghostty**. It walks the text lines, scans and "indexes" the links it finds, flees your cursor, plays dead when you click it, eats the flies you drop, hatches spiderlings and builds webs in quiet corners. Split the pane and it keeps crawling through the reflow.

![demo](media/demo.mp4)

## Run

Needs macOS (Metal), [Bun](https://bun.sh) and Ghostty or kitty. The video uses Ghostty with `theme = GitHub Dark High Contrast`.

```sh
cd gpuix/crawler
bun install
bun link            # puts `crawler` on your PATH (or run ./crawler.tsx)

crawler                         # mock "how do spiders walk" results page, 1 spider
crawler -n 3                    # start with three spiders
crawler https://example.com     # fetch a real page and crawl it
crawler --help
```

Control a running crawler from another pane (Cmd-D in Ghostty, then):

```sh
crawler feed 6        # drop six flies into every running crawler
crawler spawn 2       # lower two more spiders on silk
crawler web           # ask a spider to build a web
crawler open https://en.wikipedia.org/wiki/Spider
crawler still on      # reduced motion
```

Keys inside the app: click empty space to drop a fly, click a spider to make it play dead, `f` flies, `s` spawn, `w` web, `c` curious (follow the cursor instead of fleeing), `x` chaos (spiders follow the links they index), `r` still, `b` back, `j`/`k`/space/wheel to scroll, Ctrl-C to quit (the terminal is restored).

`-w` opens a native GPUIX window instead of painting in the terminal.

```sh
bun test            # pure-logic tests + GPUIX test-renderer tests
bun run typecheck
```

## How it is built

| file | what it does |
| --- | --- |
| `crawler.tsx` | CLI entry (`bin`), `--help`, subcommands, terminal/window render |
| `src/app.tsx` | GPUIX UI: header, page view, footer, one animation loop, input |
| `src/page.ts` | mock search-results page; `fetch` + Bun `HTMLRewriter` for real URLs |
| `src/sim.ts` | world: fixed-timestep (120 Hz) behaviour state machine, flies, webs, scans |
| `src/spider.ts` | body, legs, gait, steering, heading spring |
| `src/math.ts` | vectors, analytic two-bone IK, critically damped spring, gait groups |
| `src/raster.ts` | CPU rasterizer (SDF capsules/ellipsoids, AA) into an RGBA buffer |
| `src/ipc.ts` | per-process Unix sockets so `crawler feed` in another pane reaches every instance |

The page is real GPUIX layout: `<text>` words in wrapping flex rows. After each layout change (page load, resize, split) the app reads `getElementBounds` for every word once and caches a **surface map** of text-line rectangles and link rectangles in page coordinates. Nothing is measured per frame. The spiders, flies, silk and webs are drawn by a small CPU rasterizer into one full-viewport `<img pointerEvents="none">` updated with `setImagePixels` every 16 ms. Scroll offset is owned by the app (the page wrapper moves by `top: -scrollY`), so the spiders stay anchored to the page, not the viewport.

## How the IK gait works

- **Legs.** Each of the 8 legs has a hip on the cephalothorax, a femur and tibia solved with analytic two-bone IK (law of cosines, knee pushed outward and upward by a bend hint) and a short tarsus that meets the page. Unreachable targets clamp to full extension.
- **Foot targets.** Every leg has a rest position fixed in the body frame. A planted foot stays exactly where it was put (the tests check zero slide). When the body has moved so far that the foot is more than **40 % of leg reach** from its rest position, the leg wants to step.
- **Tetrapod gait.** Legs are in two groups, L1 R2 L3 R4 and R1 L2 R3 L4. Only one group may be in the air at a time, so no two adjacent legs ever lift together (also tested). The group with the most "wanting" legs goes next.
- **Steps.** A step lasts ~120 ms (shorter when running), lifts the foot on a sine arc, eases out into the new target and overshoots slightly along the walking direction so the next step comes later.
- **Body.** It hovers at a fixed height with a small bob tied to the gait phase, leans into acceleration, breathes (abdomen scale), and turns with a critically damped spring toward its heading.

Behaviours (`sim.ts`): drop on silk → wander along text lines → notice link → walk to link → scan (highlight sweep + `indexed: domain` tooltip, link turns green) → optionally follow it in chaos mode → wander. Cursor within ~80 px → flee, then freeze. Click → curl legs and play dead for 2 s. Flies → hunt, eat, get fatter; every third fly hatches a spiderling. Bored → build a web (radial spokes then spiral over ~2 s) in a margin.

## Adapted from the original prompt

The original was a browser script/bookmarklet that drops a spider on any website. Here it is a terminal app:

- **Page:** a mock search-results page (the "indexing" joke) or a real URL fetched and rendered as GPUIX elements (title, headings, paragraphs, list items, quotes, links). It is a reading view, not a browser: no CSS, images or JS from the site.
- **Bookmarklet / Shadow DOM / "works on 5 sites":** cut. There is no host page to inject into. The equivalent is `crawler <url>` on any page. Parsing was checked against example.com, Wikipedia, Hacker News and MDN; the Wikipedia article was also run live in Ghostty. Fetched pages are capped at ~900 words / 80 blocks: every word is a GPUIX `<text>` node and the full Wikipedia article (thousands of nodes) dropped the loop to ~13 fps on the paravirtual GPU; with the cap it runs at 55–57 fps. Pages with `<main>`/`<article>` are read from there only; navigation, infoboxes and Wikipedia language lists are skipped. Pages that render their content with JavaScript show little or nothing.
- **Surface map:** built from GPUIX `getElementBounds` on words instead of `Range.getClientRects`, cached and rebuilt on resize, split and navigation.
- **Silk:** spiders arrive by dropping on a silk thread with a pendulum swing; mid-walk drops between elements were simplified away.
- **Chaos mode** navigates the same terminal app to the link instead of opening a browser tab.
- **Recording mode** isn't needed (no chrome to hide); `prefers-reduced-motion` becomes `-r` / `r` / `crawler still on`.
- **Extras for the terminal:** feeding, spiderlings, curious mode, and IPC so another pane can feed or spawn spiders in every running crawler.
- No README GIF; the demo is `media/demo.mp4`.

## Performance

The VM used for development has an **Apple Paravirtual GPU** (Metal), which is much slower than a real Mac. In Ghostty at 1417×876 px the animation loop measured **56–59 fps** (`CRAWLER_FPS_LOG=/tmp/fps.log crawler` writes the measured rate each second). GPUIX terminal frames are demand-driven and capped near 60 Hz. `CRAWLER_STATE=/tmp/cs.json` dumps spider positions (terminal coordinates) ten times a second; the demo driver used it to aim clicks.

## GPUIX findings (0.11.0)

- `<img>` + `setImagePixels` over a full viewport at ~60 Hz works well in terminal mode; a pointer-events-none overlay keeps clicks on the page below.
- `getElementBounds` is only valid after a paint, so measure in a `setTimeout` after the layout commit, not during render.
- Owning the scroll offset in React (absolute page wrapper) was simpler than a native `overflow: scroll` container because the raster overlay must stay in sync with the page.
- Modifiers arrive as `ctrl`/`alt`/`shift`/`cmd`; printable keys arrive in `keyChar`. Left mouse button is `0`.
- GPUIX's own `[gpuix] created native window` / `mount complete` messages are `console.log` calls held until exit, so they printed under the restored prompt. `RUST_LOG=error` in the shebang silences the Rust side only; `crawler.tsx` filters `[gpuix]` console lines.
- In the test renderer, `setImagePixels` on an `<img>` failed with "setImage is only valid on <img>, got <div>", so the app tests render with `animate={false}`.
- Ghostty owns Cmd shortcuts, so every app action has a plain key.
