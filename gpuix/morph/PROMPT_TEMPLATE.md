# Prompt template: "one shape that never cuts" as a GPUIX terminal app

Reuse this to make another code-only UI motion piece with different states. Fill in the brackets.

```
Build a 14-second UI motion piece in code with GPUIX (@gpuix/react@0.11.0, React 19, Bun), played live
inside Ghostty (`render(<App/>, { terminal: true })`) and exported frame-exact to MP4 with the GPUIX test
renderer (`captureScreenshot` per frame, then ffmpeg).

States, in order (one rounded rectangle becomes each of them, then returns to the first):
  [button] → [loader] → [checkmark] → [...] → [back to button]

Palette: [terminal theme background + foreground] with one accent [#FF4D00]. Font: [Geist]. Icon stroke: [1.5 px].

Rules
- One continuous element. Never cut, never fade the shape out. Only width, height, corner radius and fill morph.
- Inner content swaps with a 6–9 frame opacity/scale crossfade.
- A visible cursor drives every change: eased bowed paths, press scale 0.96, drags.
- Springs only (damped, ≤5 % overshoot), frame-based so every frame is deterministic.
- A camera scale keeps each state at about 60 % of the frame.
- The last frame equals the first.

Timing: [120] BPM at 60 fps, one beat = [30] frames, [28] beats. Write beats.ts as
  { beat, state?, cursor: [{ kind: move|click|drag|type|idle, ... }], note }
with an event on every beat. State changes must land on their beat (±1 frame).

App: artboard + timeline (one block per state, beat ticks, playhead), play/pause, frame-step keys,
drag/scroll to scrub, palette + aspect toggles, an Export button that runs `<bin> --export` as a child.
CLI: `<bin>`, `<bin> --export out.mp4`, `<bin> --check` (beat map + first/last pixel diff), `--help`.

Acceptance
- `<bin> --check` passes: every state change on its beat, frame 0 and the last frame pixel-identical.
- `bun test` and `bun run typecheck` pass.
- It reflows in half a Ghostty split and Ctrl-C restores the prompt.
```
