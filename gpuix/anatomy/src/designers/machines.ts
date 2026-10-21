import { Assembly, C, TAU, ghost, glow, wire, solid, meshPhase } from './kit'
import type { MachineSpec, Vec3 } from '../spec/types'

/**
 * Mechanical watch movement. The escape wheel is the master: it steps 30 times per revolution in time with a 3 Hz
 * balance (21,600 bph), and the going train is derived back up from it with real tooth counts, so the seconds wheel
 * turns once a minute, the centre wheel once an hour, and the motion works divide that by 12 for the hour wheel.
 */
export function watch(prompt?: string): MachineSpec {
  const a = new Assembly()
  const m = 0.12
  const plate = a.add('mainplate', 'Main plate', 'Base of the movement; every arbor pivots in jewels set into it.', { type: 'cylinder', radius: 14.5, height: 0.8, segments: 48 }, ghost(C.steel), { pos: [0, -0.6, 0], explode: [0, -4, 0] })
  // Train layout: [id, label, wheel teeth, pinion teeth (meshes previous wheel), angle from previous arbor (deg), wheel height]
  const train: [string, string, number, number, number, number, string][] = [
    ['barrel', 'Mainspring barrel', 80, 0, 0, 0.6, 'Holds the coiled mainspring; its toothed rim drives the whole going train.'],
    ['center', 'Centre wheel', 64, 10, 20, 1.4, 'Turns once an hour and carries the minute hand through the cannon pinion.'],
    ['third', 'Third wheel', 60, 8, 95, 2.2, 'Intermediate wheel that steps the speed up between the centre and seconds wheels.'],
    ['fourth', 'Fourth (seconds) wheel', 84, 8, 30, 1.0, 'Turns exactly once a minute; the small-seconds hand rides on its arbor.'],
    ['escape', 'Escape wheel', 15, 7, -40, 1.8, 'Released one half-tooth per beat by the pallet fork: the source of the tick.'],
  ]
  const pos: Vec3[] = []
  // Build positions from the barrel outwards using pitch radii, and record each arbor's angle relation to the escape wheel.
  let p: Vec3 = [-6.6, 0, 3.4]
  pos.push(p)
  for (let i = 1; i < train.length; i++) {
    const prevWheel = train[i - 1]![2]
    const [, , , pin, ang] = train[i]!
    const d = (m * (prevWheel + pin)) / 2
    const t = (ang * Math.PI) / 180
    p = [p[0] + Math.cos(t) * d, 0, p[2] + Math.sin(t) * d]
    pos.push(p)
  }
  // Ratios relative to the previous arbor: ω_i = -(wheel_{i-1}/pinion_i) ω_{i-1}. Master is the escape wheel.
  const ratioToPrev = train.map((row, i) => (i === 0 ? 1 : -(train[i - 1]![2] / row[3])))
  const ids = train.map((r) => r[0])
  const phases: number[] = new Array(train.length).fill(0)
  // Mesh phases computed from the escape wheel back up the train (rest angle of the master is 0).
  const restAngle: number[] = new Array(train.length).fill(0)
  for (let i = train.length - 2; i >= 0; i--) {
    // Gear i (wheel, teeth train[i][2]) meshes with pinion of i+1 (train[i+1][3]). Treat the pinion as A.
    const zA = train[i + 1]![3], zB = train[i]![2]
    const beta = Math.atan2(pos[i]![2] - pos[i + 1]![2], pos[i]![0] - pos[i + 1]![0])
    const ph = meshPhase(zA, restAngle[i + 1]!, zB, beta)
    phases[i] = ph
    restAngle[i] = (ph * Math.PI) / 180
  }
  for (let i = 0; i < train.length; i++) {
    const [id, label, wheel, pin, , h, desc] = train[i]!
    const isEscape = id === 'escape'
    // Each arbor is driven by the next one down the train, ending at the escape wheel (the master).
    const anim = isEscape
      ? { type: 'rotate' as const, axis: [0, 1, 0] as Vec3, rpm: 12, ticks: 30 }
      : { type: 'rotate' as const, axis: [0, 1, 0] as Vec3, drivenBy: ids[i + 1]!, ratio: 1 / ratioToPrev[i + 1]!, phase: phases[i]! }
    const color = id === 'barrel' ? C.brass : isEscape ? C.cyan : C.yellow
    a.add(id, label, desc, isEscape
      ? { type: 'gear', teeth: wheel, module: m * 1.6, thickness: 0.3, bore: 0.3, spokes: 4, pressureAngle: 30 }
      : { type: 'gear', teeth: wheel, module: m, thickness: id === 'barrel' ? 1.4 : 0.35, bore: 0.3, spokes: id === 'barrel' ? 0 : 4 }, wire(color), { parent: plate, pos: [pos[i]![0], h, pos[i]![2]], anim, explode: [0, 2 + i * 1.6, 0], note: id === 'fourth' ? '1 rev / minute' : id === 'center' ? '1 rev / hour' : undefined })
    if (pin) a.add(`${id}-pinion`, `${label.split(' (')[0]} pinion`, `${pin}-leaf pinion driven by the previous wheel in the train.`, { type: 'gear', teeth: pin, module: m, thickness: 0.9, bore: 0.15 }, wire(C.light), { parent: id, pos: [0, -h + 0.6, 0] })
    a.add(`${id}-arbor`, `${label.split(' (')[0]} arbor`, 'Steel axle whose pivots run in synthetic ruby jewels.', { type: 'cylinder', radius: 0.18, height: 4, segments: 8 }, wire(C.steel), { parent: id, pos: [0, 0.4 - h + 1.4, 0] })
    a.add(`${id}-jewel`, `${label.split(' (')[0]} jewel`, 'Synthetic ruby bearing: hard, smooth and self-lubricating for decades.', { type: 'torus', radius: 0.45, tube: 0.18, segments: 14 }, glow(C.red), { parent: plate, pos: [pos[i]![0], 0.5, pos[i]![2]] })
  }
  if (true) {
    const bi = 0
    a.add('mainspring', 'Mainspring', 'Coiled power source; it unwinds over ~40 hours as the barrel turns.', { type: 'pipe', path: spiral(1.0, 4.4, 5.5, 220, 0.5), radius: 0.12 }, wire(C.blue), { parent: ids[bi], pos: [0, 0, 0] })
  }
  // Escapement: pallet fork and balance.
  const esc = pos[4]!
  const balPos: Vec3 = [esc[0] + 6.4, 2.6, esc[2] - 2.8]
  const forkPos: Vec3 = [(esc[0] + balPos[0]) / 2 + 0.4, 1.8, (esc[2] + balPos[2]) / 2 - 0.4]
  const dirFB = Math.atan2(balPos[2] - esc[2], balPos[0] - esc[0])
  a.add('pallet-fork', 'Pallet fork', 'Rocks with the balance, locking and releasing the escape wheel one tooth-half per beat.', { type: 'extrude', points: [[-2.6, -0.25], [1.8, -0.25], [2.2, 0], [1.8, 0.25], [-2.6, 0.25], [-3.0, 0.9], [-3.3, 0.7], [-2.9, 0], [-3.3, -0.7], [-3.0, -0.9]], depth: 0.25 }, wire(C.red), { parent: plate, pos: forkPos, rot: [90, (-dirFB * 180) / Math.PI, 0], anim: { type: 'oscillate', axis: [0, 0, 1], amplitude: 9, frequency: 3, phase: -153 }, explode: [0, 9, 0] })
  const balance = a.add('balance', 'Balance wheel', 'The regulator: swings back and forth 6 times a second (21,600 beats per hour).', { type: 'torus', radius: 4.2, tube: 0.25, segments: 48 }, wire(C.light), { parent: plate, pos: balPos, anim: { type: 'oscillate', axis: [0, 1, 0], amplitude: 220, frequency: 3, phase: -153 }, explode: [0, 12, 0], note: '3 Hz · 21,600 bph' })
  for (let k = 0; k < 3; k++) a.add(`balance-arm-${k + 1}`, `Balance arm ${k + 1}`, 'Spoke joining the balance rim to its staff.', { type: 'box', size: [4.1, 0.15, 0.3] }, wire(C.light), { parent: balance, pos: [Math.cos((k * TAU) / 3) * 2.05, 0, Math.sin((k * TAU) / 3) * 2.05], rot: [0, (-k * 360) / 3, 0] })
  a.add('hairspring', 'Hairspring', 'Flat spiral spring that pulls the balance back to centre and sets its frequency.', { type: 'pipe', path: spiral(0.5, 2.6, 7, 260, 0), radius: 0.06 }, glow(C.cyan), { parent: plate, pos: [balPos[0], balPos[1] + 0.6, balPos[2]], anim: { type: 'oscillate', axis: [0, 1, 0], amplitude: 60, frequency: 3, phase: -153 }, explode: [0, 14, 0] })
  a.add('balance-cock', 'Balance cock', 'Bridge holding the balance staff\u2019s upper jewel.', { type: 'extrude', points: [[0, -1], [9, -1.6], [9.6, 0], [9, 1.6], [0, 1]], depth: 0.5 }, ghost(C.steel), { parent: plate, pos: [balPos[0] - 0.4, 3.6, balPos[2]], rot: [90, -35, 0], explode: [0, 16, 0] })
  // Motion works: cannon pinion on the centre wheel, minute wheel, hour wheel (12:1).
  const cpos = pos[1]!
  const cannon = a.add('cannon-pinion', 'Cannon pinion', 'Friction-fit on the centre arbor; carries the minute hand and drives the motion works.', { type: 'gear', teeth: 12, module: m, thickness: 0.6, bore: 0.2 }, wire(C.green), { parent: plate, pos: [cpos[0], -1.6, cpos[2]], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: 'center', ratio: 1 }, explode: [0, -6, 0] })
  const mwd = (m * (12 + 36)) / 2
  a.add('minute-wheel', 'Minute wheel', '36 teeth on the cannon pinion, with a 10-leaf pinion that drives the hour wheel.', { type: 'gear', teeth: 36, module: m, thickness: 0.4, bore: 0.2 }, wire(C.green), { parent: plate, pos: [cpos[0] + mwd, -1.6, cpos[2]], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: cannon, ratio: -12 / 36, phase: meshPhase(12, 0, 36, 0) }, explode: [0, -8, 0] })
  a.add('hour-wheel', 'Hour wheel', 'Completes the 12:1 reduction and carries the hour hand.', { type: 'gear', teeth: 40, module: m, thickness: 0.4, bore: 0.6, spokes: 4 }, wire(C.green), { parent: plate, pos: [cpos[0], -2.2, cpos[2]], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: cannon, ratio: 1 / 12 }, explode: [0, -10, 0] })
  a.add('crown', 'Crown and stem', 'Winds the mainspring and sets the hands when pulled out.', { type: 'cylinder', radius: 0.35, height: 9, segments: 10 }, wire(C.steel), { parent: plate, pos: [15.5, 0.5, 0], rot: [0, 0, 90], explode: [8, 0, 0] })
  a.add('crown-knob', 'Crown', 'Knurled knob turned by your fingers.', { type: 'gear', teeth: 24, module: 0.15, thickness: 1.6, bore: 0.3 }, wire(C.brass), { parent: 'crown', pos: [0, -5, 0], explode: [0, -3, 0] })
  return a.spec({ name: 'Mechanical watch movement', description: 'A hand-wound movement: barrel, going train, Swiss lever escapement and a 3 Hz balance, with real tooth counts.', unit: 'mm', camera: { view: 'iso', zoom: 1 }, ...(prompt ? { prompt } : {}) }, 40)
}

function spiral(r0: number, r1: number, turns: number, n: number, rise: number): Vec3[] {
  const pts: Vec3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const ang = t * turns * TAU
    const r = r0 + (r1 - r0) * t
    pts.push([Math.cos(ang) * r, rise * t, Math.sin(ang) * r])
  }
  return pts
}

/** Two-spool high-bypass turbofan. The LP spool is the master; the HP spool runs at a fixed ratio for display. */
export function turbofan(prompt?: string): MachineSpec {
  const a = new Assembly()
  // Axis along X: geometry built along Y, rotated by z=-90° so +Y points forward... we use rot [0,0,90] (Y -> -X).
  const rot: Vec3 = [0, 0, 90]
  const lp = 'lp-shaft', hp = 'hp-shaft'
  const nacelle = a.add('nacelle', 'Nacelle', 'Aerodynamic cowl around the fan; most of the thrust is bypass air flowing inside it.', { type: 'lathe', points: [[118, -150], [128, -130], [130, -40], [122, 60], [112, 120], [108, 125]], segments: 40 }, ghost(C.steel), { rot, explode: [0, 0, 0] })
  const core = a.add('core-case', 'Core casing', 'Encloses the compressor, combustor and turbines of the gas generator.', { type: 'lathe', points: [[62, -70], [58, 20], [50, 120], [46, 210], [38, 260]], segments: 32 }, ghost(C.blue), { parent: nacelle, explode: [0, -60, 0] })
  a.add(lp, 'Low-pressure shaft', 'Inner shaft: the LP turbine at the back drives the fan and booster at the front.', { type: 'cylinder', radius: 5, height: 420, segments: 10 }, wire(C.light), { parent: nacelle, pos: [0, 70, 0], anim: { type: 'rotate', axis: [0, 1, 0], rpm: 90 }, explode: [0, 0, 0], note: 'master: LP spool' })
  a.add(hp, 'High-pressure shaft', 'Hollow outer shaft: the HP turbine drives the HP compressor.', { type: 'cylinder', radius: 10, height: 150, segments: 12, hollow: 7 }, wire(C.cyan), { parent: nacelle, pos: [0, 120, 0], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: lp, ratio: -2.4 }, explode: [0, 0, 0] })
  a.add('spinner', 'Spinner', 'Nose cone that smooths airflow into the fan hub.', { type: 'cone', radius: 30, height: 48, segments: 20 }, wire(C.light), { parent: lp, pos: [0, -228, 0], rot: [180, 0, 0], explode: [0, -160, 0] })
  a.add('fan', 'Fan', '22 wide-chord blades; pushes ~90% of the engine\u2019s air around the core as bypass thrust.', { type: 'blades', count: 22, radius: 118, hub: 30, chord: 34, twist: 42 }, wire(C.light), { parent: lp, pos: [0, -190, 0], explode: [0, -120, 0] })
  for (let i = 0; i < 3; i++) a.add(`booster-${i + 1}`, `Booster stage ${i + 1}`, 'Low-pressure compressor stage on the LP shaft that pre-compresses core air.', { type: 'blades', count: 28, radius: 60 - i * 2, hub: 34, chord: 12, twist: 30 }, wire(C.blue), { parent: lp, pos: [0, -140 + i * 22, 0], explode: [0, -90 + i * 12, 0] })
  for (let i = 0; i < 6; i++) a.add(`hpc-${i + 1}`, `HP compressor stage ${i + 1}`, 'High-pressure compressor stage squeezing air ~30:1 before combustion.', { type: 'blades', count: 36, radius: 52 - i * 3, hub: 30, chord: 9, twist: 24 }, wire(C.cyan), { parent: hp, pos: [0, -60 + i * 16, 0], explode: [0, -40 + i * 10, 0] })
  a.add('combustor', 'Annular combustor', 'Fuel burns continuously here; the hot gas expands through the turbines behind it.', { type: 'torus', radius: 42, tube: 9, segments: 32 }, glow(C.orange, { effect: 'fire', effectTarget: [0, 1, 0] }), { parent: core, pos: [0, 70, 0], explode: [0, 30, 0], note: 'continuous combustion' })
  for (let i = 0; i < 2; i++) a.add(`hpt-${i + 1}`, `HP turbine stage ${i + 1}`, 'Extracts energy from the hottest gas to drive the HP compressor.', { type: 'blades', count: 40, radius: 48, hub: 32, chord: 9, twist: -30 }, wire(C.yellow), { parent: hp, pos: [0, 60 + i * 14, 0], explode: [0, 60 + i * 10, 0] })
  for (let i = 0; i < 4; i++) a.add(`lpt-${i + 1}`, `LP turbine stage ${i + 1}`, 'Extracts the remaining energy to spin the fan through the LP shaft.', { type: 'blades', count: 44, radius: 50 + i * 3, hub: 30, chord: 10, twist: -28 }, wire(C.orange), { parent: lp, pos: [0, 120 + i * 18, 0], explode: [0, 90 + i * 14, 0] })
  a.add('nozzle', 'Exhaust nozzle', 'Accelerates the core exhaust; the cone and lip shape the jet.', { type: 'cone', radius: 26, height: 70, segments: 18 }, wire(C.steel, { effect: 'smoke', effectTarget: [0, 1, 0] }), { parent: core, pos: [0, 280, 0], explode: [0, 120, 0] })
  a.add('pylon', 'Pylon', 'Strut that hangs the engine under the wing and carries fuel and bleed lines.', { type: 'box', size: [30, 260, 50] }, ghost(C.gray), { parent: nacelle, pos: [150, 40, 0], explode: [100, 0, 0] })
  for (let i = 0; i < 10; i++) a.add(`ogv-${i + 1}`, `Outlet guide vane ${i + 1}`, 'Static vane that straightens the swirling bypass flow behind the fan.', { type: 'box', size: [60, 6, 2] }, wire(C.gray), { parent: nacelle, pos: [Math.cos((i * TAU) / 10) * 90, -150, Math.sin((i * TAU) / 10) * 90], rot: [0, (-i * 360) / 10, 0] })
  void solid
  return a.spec({ name: 'Two-spool turbofan', description: 'A high-bypass turbofan: fan and booster on the LP spool, compressor and turbine on the HP spool, a burning annular combustor.', unit: 'mm', camera: { view: 'iso', yaw: -0.5, zoom: 1 }, ...(prompt ? { prompt } : {}) }, 800)
}

/** 2-6-0 steam locomotive: three coupled drivers, crossheads and main rods quartered at 90° per side. */
export function locomotive(prompt?: string): MachineSpec {
  const a = new Assembly()
  const R = 70, gauge = 150, rpm = 30, crankR = 26
  const frame = a.add('frame', 'Frame', 'Bar frame carrying the boiler, cylinders and axle boxes.', { type: 'box', size: [620, 30, gauge - 30] }, ghost(C.gray), { pos: [0, R + 20, 0] })
  a.add('boiler', 'Boiler', 'Fire-tube boiler: hot gas from the firebox boils the water around the tubes.', { type: 'cylinder', radius: 70, height: 440, segments: 28 }, ghost(C.blue), { parent: frame, pos: [40, 105, 0], rot: [0, 0, 90], explode: [0, 120, 0] })
  a.add('smokebox', 'Smokebox', 'Front chamber where exhaust steam drafts the fire up the chimney.', { type: 'cylinder', radius: 74, height: 90, segments: 28 }, wire(C.steel), { parent: frame, pos: [300, 105, 0], rot: [0, 0, 90], explode: [80, 120, 0] })
  a.add('chimney', 'Chimney', 'Stack where exhaust steam and smoke leave in rhythmic chuffs.', { type: 'lathe', points: [[18, 0], [16, 40], [22, 60], [24, 64]], segments: 16 }, wire(C.steel, { effect: 'smoke', effectTarget: [0, 1, 0] }), { parent: frame, pos: [310, 170, 0], explode: [0, 220, 0] })
  a.add('dome', 'Steam dome', 'Collects the driest steam at the top of the boiler for the regulator.', { type: 'capsule', radius: 22, height: 14, segments: 14 }, wire(C.brass), { parent: frame, pos: [120, 182, 0], explode: [0, 200, 0] })
  a.add('firebox', 'Firebox', 'Coal burns here; radiant heat makes most of the steam.', { type: 'box', size: [130, 120, gauge - 20] }, glow(C.orange, { effect: 'fire', effectTarget: [0, 1, 0] }), { parent: frame, pos: [-250, 60, 0], explode: [-80, 60, 0] })
  a.add('cab', 'Cab', 'Crew shelter with the regulator, reverser and firehole door.', { type: 'box', size: [150, 150, gauge + 50] }, ghost(C.steel), { parent: frame, pos: [-260, 185, 0], explode: [-120, 160, 0] })
  for (const s of [-1, 1]) a.add(`rail-${s < 0 ? 'l' : 'r'}`, `Rail ${s < 0 ? 'left' : 'right'}`, 'Steel rail the flanged wheels ride on.', { type: 'box', size: [900, 10, 10] }, wire(C.gray), { pos: [0, -5, (s * gauge) / 2], explode: [0, -40, 0] })
  const drivers = [-150, -20, 110]
  drivers.forEach((x, i) => {
    a.add(`axle-${i + 1}`, `Driving axle ${i + 1}`, i === 1 ? 'Main driving axle: the main rods push on its crank pins.' : 'Coupled axle turned by the coupling rods.', { type: 'cylinder', radius: 9, height: gauge + 40, segments: 10 }, wire(C.light), { pos: [x, R, 0], rot: [90, 0, 0], anim: { type: 'rotate', axis: [0, -1, 0], drivenBy: i === 1 ? undefined : 'axle-2', rpm: i === 1 ? rpm : undefined, ratio: 1 }, explode: [0, -60, 0], note: i === 1 ? `${rpm} rpm master` : undefined })
    for (const s of [-1, 1]) {
      const wid = a.add(`driver-${i + 1}${s < 0 ? 'l' : 'r'}`, `Driving wheel ${i + 1}${s < 0 ? 'L' : 'R'}`, 'Spoked driving wheel with a counterweight opposite the crank pin.', { type: 'torus', radius: R - 5, tube: 5, segments: 40 }, wire(C.light), { parent: `axle-${i + 1}`, pos: [0, (s * gauge) / 2, 0], explode: [0, s * 60, 0] })
      for (let k = 0; k < 10; k++) a.add(`spoke-${i + 1}${s < 0 ? 'l' : 'r'}-${k}`, 'Spoke', 'Cast spoke between hub and rim.', { type: 'box', size: [R - 14, 4, 5] }, wire(C.steel), { parent: wid, pos: [Math.cos((k * TAU) / 10) * (R / 2 - 2), 0, Math.sin((k * TAU) / 10) * (R / 2 - 2)], rot: [0, (-k * 360) / 10, 0] })
      a.add(`weight-${i + 1}${s < 0 ? 'l' : 'r'}`, 'Counterweight', 'Balances the rods so the engine runs smoothly at speed.', { type: 'extrude', points: Array.from({ length: 9 }, (_, k) => { const t = Math.PI * 0.7 + (k / 8) * Math.PI * 0.6; return [Math.cos(t) * (R - 12), Math.sin(t) * (R - 12)] as [number, number] }).concat([[-(R - 12) * 0.3, 0]]), depth: 6 }, wire(C.gray), { parent: wid, rot: [90, (s < 0 ? 0 : -90), 0] })
      // Right side leads the left by 90° (quartering) so the engine can always start.
      const q = s < 0 ? 0 : Math.PI / 2
      a.add(`pin-${i + 1}${s < 0 ? 'l' : 'r'}`, `Crank pin ${i + 1}${s < 0 ? 'L' : 'R'}`, 'Pin on the wheel boss where the rods attach.', { type: 'cylinder', radius: 6, height: 26, segments: 8 }, wire(C.yellow), { parent: wid, pos: [Math.cos(q) * crankR, s * 14, Math.sin(q) * crankR] })
    }
  })
  for (const s of [-1, 1]) {
    const side = s < 0 ? 'l' : 'r'
    const q = s < 0 ? 0 : Math.PI / 2
    const zOut = (s * gauge) / 2 + s * 24
    const pinLocal: Vec3 = [Math.cos(q) * crankR, (s * gauge) / 2 + s * 24, Math.sin(q) * crankR]
    a.add(`coupling-rod-${side}`, `Coupling rod ${side.toUpperCase()}`, 'Ties the three drivers together so they turn as one.', { type: 'box', size: [drivers[2]! - drivers[0]! + 30, 10, 6] }, wire(C.cyan), { anim: { type: 'follow', part: 'axle-2', point: [pinLocal[0], pinLocal[1] + s * 4, pinLocal[2]] }, explode: [0, 0, s * 70] })
    const cylX = 300
    a.add(`cylinder-${side}`, `Steam cylinder ${side.toUpperCase()}`, 'Double-acting: steam pushes the piston both ways, twice per revolution.', { type: 'cylinder', radius: 30, height: 110, segments: 18 }, ghost(C.steel), { parent: frame, pos: [cylX, 0, zOut + s * 8], rot: [0, 0, 90], explode: [60, 0, s * 80] })
    const xh = a.add(`crosshead-${side}`, `Crosshead ${side.toUpperCase()}`, 'Slides in the guides, joining piston rod to main rod.', { type: 'box', size: [30, 26, 14] }, wire(C.light), { anim: { type: 'crank', crank: 'axle-2', pin: pinLocal, direction: [1, 0, 0], rod: 220 }, explode: [40, 0, s * 110] })
    a.add(`piston-rod-${side}`, `Piston rod ${side.toUpperCase()}`, 'Carries piston thrust out of the cylinder to the crosshead.', { type: 'cylinder', radius: 4, height: 120, segments: 8 }, wire(C.light), { parent: xh, pos: [60, 0, 0], rot: [0, 0, 90] })
    a.add(`piston-${side}`, `Piston ${side.toUpperCase()}`, 'Driven by expanding steam, alternately from each side.', { type: 'cylinder', radius: 26, height: 18, segments: 16 }, wire(C.yellow), { parent: xh, pos: [120, 0, 0], rot: [0, 0, 90] })
    a.add(`main-rod-${side}`, `Main rod ${side.toUpperCase()}`, 'Transfers piston thrust to the main driver\u2019s crank pin.', { type: 'box', size: [12, 220, 8] }, wire(C.blue), { anim: { type: 'rod', piston: xh }, explode: [0, 0, s * 90] })
    a.add(`guides-${side}`, `Slide bars ${side.toUpperCase()}`, 'Keep the crosshead moving in a straight line.', { type: 'box', size: [160, 4, 10] }, wire(C.gray), { parent: frame, pos: [cylX - 115, 0, zOut], explode: [40, 0, s * 100] })
    a.add(`eccentric-${side}`, `Valve gear ${side.toUpperCase()}`, 'Swinging link that times steam admission, a quarter turn ahead of the piston.', { type: 'box', size: [8, 70, 6] }, wire(C.green), { parent: frame, pos: [210, 20, zOut + s * 12], anim: { type: 'oscillate', axis: [0, 0, 1], amplitude: 18, frequency: 1, driver: 'axle-2', phase: s < 0 ? 90 : 180 }, explode: [0, 40, s * 120] })
  }
  for (let k = 0; k < 2; k++) {
    a.add(`pony-axle-${k}`, 'Pony truck axle', 'Leading axle that guides the engine into curves.', { type: 'cylinder', radius: 7, height: gauge + 20, segments: 10 }, wire(C.steel), { pos: [370, 40, 0], rot: [90, 0, 0], anim: { type: 'rotate', axis: [0, -1, 0], drivenBy: 'axle-2', ratio: R / 40 }, explode: [80, -40, 0] })
    for (const s of [-1, 1]) a.add(`pony-wheel-${k}${s}`, 'Pony wheel', 'Small unpowered leading wheel.', { type: 'cylinder', radius: 40, height: 10, segments: 20, hollow: 8 }, wire(C.steel), { parent: `pony-axle-${k}`, pos: [0, (s * gauge) / 2, 0] })
    break
  }
  return a.spec({ name: 'Steam locomotive (2-6-0)', description: 'A Mogul steam locomotive: crossheads, main rods and coupling rods quartered at 90° and driven from one axle.', unit: 'mm', camera: { view: 'iso', yaw: -0.45, zoom: 1 }, ...(prompt ? { prompt } : {}) }, 1200)
}

/** Planetary gearset with a fixed ring: sun drives, carrier output at Zs/(Zs+Zr). */
export function planetary(prompt?: string): MachineSpec {
  const a = new Assembly()
  const m = 2, Zs = 24, Zp = 18, Zr = Zs + 2 * Zp
  const rpm = 30
  const housing = a.add('housing', 'Housing', 'Holds the ring gear stationary and supports the input and output shafts.', { type: 'cylinder', radius: (m * Zr) / 2 + 16, height: 46, segments: 48, hollow: (m * Zr) / 2 + 6 }, ghost(C.steel))
  a.add('ring', 'Ring gear', `${Zr} internal teeth, held fixed: the planets roll around inside it.`, { type: 'torus', radius: (m * Zr) / 2 + 3, tube: 3, segments: 64 }, wire(C.blue), { parent: housing, explode: [0, -40, 0] })
  const sun = a.add('sun', 'Sun gear', `${Zs}-tooth input gear at the centre, driven at ${rpm} rpm.`, { type: 'gear', teeth: Zs, module: m, thickness: 16, bore: 6 }, wire(C.yellow), { anim: { type: 'rotate', axis: [0, 1, 0], rpm }, explode: [0, 50, 0], note: `${rpm} rpm input` })
  a.add('input-shaft', 'Input shaft', 'Turns the sun gear.', { type: 'cylinder', radius: 5, height: 80, segments: 10 }, wire(C.light), { parent: sun, pos: [0, 40, 0] })
  const carrier = a.add('carrier', 'Planet carrier', `Output: turns ${(Zs / (Zs + Zr)).toFixed(3)}× sun speed in the same direction.`, { type: 'cylinder', radius: (m * (Zs + Zp)) / 2 + 12, height: 6, segments: 40 }, ghost(C.green), { pos: [0, -14, 0], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: sun, ratio: Zs / (Zs + Zr) }, explode: [0, -60, 0] })
  for (let k = 0; k < 3; k++) {
    const ang = (k * TAU) / 3, d = (m * (Zs + Zp)) / 2
    const rel = -(Zs / Zp) * (Zr / (Zs + Zr))
    a.add(`planet-${k + 1}`, `Planet gear ${k + 1}`, `${Zp} teeth: meshes with both the sun and the fixed ring.`, { type: 'gear', teeth: Zp, module: m, thickness: 16, bore: 5 }, wire(C.light), { parent: carrier, pos: [Math.cos(ang) * d, 14, Math.sin(ang) * d], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: sun, ratio: rel, phase: meshPhase(Zs, 0, Zp, -ang) }, explode: [Math.cos(ang) * 50, 20, Math.sin(ang) * 50] })
  }
  return a.spec({ name: 'Planetary gearset', description: 'Sun in, carrier out, ring fixed: a compact reduction used in automatic gearboxes.', unit: 'mm', camera: { view: 'iso', zoom: 1 }, ...(prompt ? { prompt } : {}) }, 300)
}
