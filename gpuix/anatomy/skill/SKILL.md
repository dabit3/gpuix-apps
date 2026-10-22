---
name: anatomy
description: Turn a one-line machine description ("a V8 engine", "a mechanical wristwatch", "a jet turbine") into a validated Anatomy machine spec and open it as an animated 3D wireframe in the terminal.
---

# Anatomy: one line of text → an interactive 3D machine

You write a JSON **machine spec** (schema: `schema/machine.schema.json`), validate it, and open it in the
GPUIX terminal runtime. Run every command from the `anatomy/` folder.

## 0. Built-in designers first

`bun src/cli.ts gen "<description>" -o specs/<slug>.json` already knows V6/V8/V12, inline-N and boxer engines,
mechanical watches, turbofans, steam locomotives and planetary gearsets. If it prints `wrote ...`, start from that
file (edit it to match the request) and skip to step 4. If it says "No built-in designer", write the spec yourself.

## Codebases

For "the anatomy of this repo/app", don't write a spec: run `anatomy <dir> [--top N]`. It scans files, lines and imports,
ranks the top modules and builds the machine itself (see the README's Codebase mode). `anatomy gen <dir> -o x.json` writes
that spec if the user wants to hand-tune it.

## 1. Decompose (12–60 parts)

Housing → subassemblies → moving parts, using `parentId`. Name real components: crankshaft, cam lobe, escape wheel,
pallet fork, compressor stage, crosshead. Every part gets a 1–2 sentence `description` of what it does.
Children inherit their parent's transform *and motion* (a crank pin parented to the crankshaft turns with it).

## 2. Geometry and proportions

Primitives: `box`, `cylinder` (optional `hollow`, `radiusTop`), `cone`, `sphere`, `torus`, `capsule`, `gear`,
`spring`, `pipe` (polyline `path`), `extrude` (2D polygon), `lathe` (2D profile), `blades` (fan/turbine rotor).
Use real proportions in one `meta.unit`. Cylinders, gears, springs and lathes are built along local **+Y**;
rotate them with `transform.rotation` (degrees, XYZ).

- Gears: `teeth`, `module`, `pressureAngle` (default 20), `bore`, `thickness`, `spokes`. Two gears mesh when their
  centre distance is `module × (z1 + z2) / 2` and they share a module.
- Springs: `radius`, `wire`, `turns`, `height`; keep `wire × turns < height`.

Materials: `style` `wire` | `solid` | `ghost` (housings, nearly invisible) | `glow`, a `#rrggbb` color, and an
optional `effect` (`fire`, `smoke`, `electric`, `plasma`, `water`) with `effectTarget` (direction or arc end) and
`pulse` (`driver`, `ratio`, `phase`, `width` in degrees) for things like firing order.

## 3. Motion from one driver

Exactly one part (crankshaft, mainspring barrel, LP shaft, driving axle) has `rotate` with `rpm`. Everything else
derives from it, so the whole machine runs off one master clock:

- `rotate` + `drivenBy` + `ratio`: meshing external gears use `ratio = -z_driver / z_driven`; a cam turns at `0.5`.
- `oscillate` with `driver` + `wave: "cam"`: valves and pallets. `mode`: `rotate` | `translate` | `scale`.
- `crank`: a piston on a crank (`crank` = rotating part, `pin` = crank pin in its local frame, `direction` = bore
  axis, `rod` = rod length). `rod` (`piston` = the crank part) draws the connecting rod between pin and wrist.
- `slide` (path + period or driver) and `follow` (stick to a point on another moving part).

## 4. Validate

```sh
bun src/cli.ts validate specs/<slug>.json
```

AJV checks the schema; custom checks catch duplicate ids, orphan parents, parent cycles, drive cycles, missing
drivers or crank references, NaN/Infinity, parts outside `bounds`, and degenerate gears/springs. Fix every issue
(the path tells you which part) and re-run until it prints `ok`.

## 5. Look at it

```sh
bun src/cli.ts snap specs/<slug>.json -o /tmp/<slug>.png   # headless PNG, check nothing sits at the origin by accident
bun src/cli.ts specs/<slug>.json                            # interactive, in Ghostty or kitty
```

While the viewer runs, edits to the file hot-reload; a broken edit shows the first validator issue and keeps the
last good machine on screen.
