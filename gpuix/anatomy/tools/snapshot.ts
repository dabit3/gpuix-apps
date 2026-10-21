#!/usr/bin/env bun
// Headless render of a spec (file or prompt) to PNG: bun tools/snapshot.ts "<prompt|file>" out.png [t] [explode] [w] [h]
import { encodePng } from '../src/png'
import { writeFileSync } from 'node:fs'
import { loadSource } from '../src/source'
import { Scene } from '../src/scene'
import { ISO_PITCH, ISO_YAW, Renderer } from '../src/render/renderer'

if (import.meta.main) {
  const [src = 'a V8 engine', out = 'snap.png', t = '0.4', ex = '0', w = '1200', h = '800'] = process.argv.slice(2)
  const { spec } = loadSource(src)
  const scene = new Scene(spec)
  const r = new Renderer()
  r.resize(+w, +h)
  const cam = spec.meta.camera ?? {}
  // Warm up particles so effects are visible in a still.
  for (let k = 0; k <= 12; k++) {
    scene.pose(+t - (12 - k) / 30, +ex)
    r.render({ scene, camera: { view: cam.view ?? 'iso', yaw: ISO_YAW + (cam.yaw ?? 0), pitch: ISO_PITCH, dist: scene.radius * 1.8 / (cam.zoom ?? 1), target: scene.center }, time: +t - (12 - k) / 30, hover: -1, selected: -1, palette: { bg: [10, 12, 16], grid: [122, 130, 142], accent: [113, 183, 255] }, effects: true })
  }
  writeFileSync(out, encodePng(r.w, r.h, r.rgba))
  console.log(`${spec.meta.name}: ${spec.parts.length} parts, ${r.lastMs.toFixed(1)} ms/frame`)
}
