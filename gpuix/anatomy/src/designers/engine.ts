import { Assembly, C, ghost, glow, wire, solid, meshPhase } from './kit'
import type { MachineSpec, Vec3 } from '../spec/types'

export interface EngineOpts { layout: 'inline' | 'v' | 'flat'; cylinders: number; rpm?: number; name?: string; prompt?: string }

/** Crank throw angles (degrees) for common layouts, one entry per crank pin. */
function throws(layout: EngineOpts['layout'], pins: number): number[] {
  if (pins === 1) return [0]
  if (layout === 'v' && pins === 4) return [0, 90, 270, 180] // cross-plane V8
  if (pins === 4) return [0, 180, 180, 0]
  if (pins === 3) return [0, 240, 120]
  if (pins === 6) return [0, 240, 120, 120, 240, 0]
  if (pins === 2) return [0, 180]
  return Array.from({ length: pins }, (_, i) => (i * 720) / pins % 360)
}

/**
 * A four-stroke piston engine. One crankshaft drives everything from the master clock: pistons ride crank-slider
 * kinematics, the camshaft turns at half speed through a chain, valves lift on cam timing, and each cylinder's
 * combustion flash (fire) and spark (electric) pulse once every two revolutions in firing order.
 */
export function engine(o: EngineOpts): MachineSpec {
  const a = new Assembly()
  const cyl = Math.max(1, Math.min(12, o.cylinders))
  const bankCount = o.layout === 'inline' || cyl === 1 ? 1 : 2
  const pins = Math.ceil(cyl / bankCount)
  const bore = 86, stroke = 86, rodLen = 145, r = stroke / 2
  const pitch = bore + 18
  const bankAngle = o.layout === 'flat' ? 90 : o.layout === 'v' ? 45 : 0
  const length = pins * pitch + (bankCount === 2 ? bore * 0.3 : 0)
  const x0 = -length / 2 + pitch / 2
  const rpm = o.rpm ?? 40
  const banks = bankCount === 1 ? [0] : [bankAngle, -bankAngle]
  const deckH = r + rodLen + 70

  const block = a.add('block', 'Cylinder block', 'Cast housing that holds the cylinders, main bearings and coolant passages.', { type: 'box', size: [length + 40, 120, bankCount === 2 ? 260 : 150] }, ghost(C.steel), { pos: [0, 30, 0], explode: [0, 0, 0] })
  a.add('oil-pan', 'Oil pan', 'Sump that collects oil drained from the bearings; the pump draws from it.', { type: 'box', size: [length + 20, 70, bankCount === 2 ? 200 : 140] }, ghost(C.gray), { parent: block, pos: [0, -125, 0], explode: [0, -120, 0] })

  const crank = a.add('crankshaft', 'Crankshaft', 'Turns the pistons\u2019 up-and-down motion into rotation. Everything else is timed from it.', { type: 'pipe', path: [[-length / 2 - 60, 0, 0], [length / 2 + 40, 0, 0]], radius: 22 }, wire(C.light), { anim: { type: 'rotate', axis: [1, 0, 0], rpm }, explode: [0, -60, 0], note: `${rpm} rpm master driver` })
  const th = throws(o.layout, pins)
  for (let i = 0; i < pins; i++) {
    const x = x0 + i * pitch
    const phi = (th[i]! * Math.PI) / 180
    const py = r * Math.cos(phi), pz = r * Math.sin(phi)
    a.add(`throw-${i + 1}`, `Crank throw ${i + 1}`, 'Counterweighted web that offsets the crank pin from the main journal.', { type: 'box', size: [16, r + 40, 52] }, wire(C.steel), { parent: crank, pos: [x - bore * 0.32, py / 2, pz / 2], rot: [(-phi * 180) / Math.PI, 0, 0] })
    a.add(`pin-${i + 1}`, `Crank pin ${i + 1}`, 'Journal the connecting rods ride on, swinging around the crank axis.', { type: 'cylinder', radius: 18, height: bankCount === 2 ? bore * 0.55 : bore * 0.4, segments: 14 }, wire(C.yellow), { parent: crank, pos: [x, py, pz], rot: [0, 0, 90] })
  }
  a.add('flywheel', 'Flywheel', 'Heavy ring gear that smooths power pulses; the starter meshes with its teeth.', { type: 'gear', teeth: 72, module: 4, thickness: 18, bore: 30, spokes: 6 }, wire(C.blue), { parent: crank, pos: [length / 2 + 30, 0, 0], rot: [0, 0, 90], explode: [140, 0, 0] })
  a.add('crank-sprocket', 'Crank sprocket', 'Drives the timing chain; it has half the teeth of the cam sprocket.', { type: 'gear', teeth: 18, module: 3, thickness: 14, bore: 10 }, wire(C.green), { parent: crank, pos: [-length / 2 - 40, 0, 0], rot: [0, 0, 90] })

  // Camshaft at half crank speed. V engines use one cam in the valley (pushrods); inline uses an overhead cam.
  const camY = bankCount === 2 ? 150 : deckH + 75
  const cam = a.add('camshaft', 'Camshaft', 'Turns at exactly half crank speed so each valve opens once per four-stroke cycle.', { type: 'pipe', path: [[-length / 2 - 40, 0, 0], [length / 2 - 20, 0, 0]], radius: 11 }, wire(C.green), { pos: [0, camY, 0], anim: { type: 'rotate', axis: [1, 0, 0], drivenBy: crank, ratio: 0.5 }, explode: [0, 90, 0], note: 'half crank speed via chain' })
  a.add('cam-sprocket', 'Cam sprocket', 'Twice the crank sprocket\u2019s teeth: the 2:1 reduction of a four-stroke.', { type: 'gear', teeth: 36, module: 3, thickness: 14, bore: 10, spokes: 4 }, wire(C.green), { parent: cam, pos: [-length / 2 - 40, 0, 0], rot: [0, 0, 90] })
  a.connections.push({ from: 'crank-sprocket', to: 'cam-sprocket', type: 'chain', radiusFrom: 27, radiusTo: 54, color: C.steel })

  // Firing order: spread power strokes evenly over 720°.
  let c = 0
  const fireOrder: number[] = []
  for (let i = 0; i < cyl; i++) fireOrder.push(i)
  for (let i = 0; i < pins; i++) {
    for (let b = 0; b < bankCount; b++) {
      if (c >= cyl) break
      c++
      const n = i * bankCount + b + 1
      const alpha = banks[b]!
      const ar = (alpha * Math.PI) / 180
      const dir: Vec3 = [0, Math.cos(ar), Math.sin(ar)]
      const x = x0 + i * pitch + (bankCount === 2 ? (b === 0 ? -1 : 1) * bore * 0.15 : 0)
      const rot: Vec3 = [alpha, 0, 0]
      const at = (d: number): Vec3 => [x, dir[1] * d, dir[2] * d]
      // TDC when the pin points along the cylinder axis: crank angle = alpha - throw.
      const tdc = ((alpha - th[i]!) % 360 + 360) % 360
      const firing = tdc + (((n - 1) * 720) / cyl >= 360 ? 360 : 0) + (n % 2 === 0 && bankCount === 1 && pins === 4 ? 0 : 0)
      const half = ((firing * 0.5) % 360 + 360) % 360
      const pinLocal: Vec3 = [x0 + i * pitch, r * Math.cos((th[i]! * Math.PI) / 180), r * Math.sin((th[i]! * Math.PI) / 180)]
      a.add(`liner-${n}`, `Cylinder ${n}`, 'Bored sleeve the piston slides in; its walls seal the combustion gases.', { type: 'cylinder', radius: bore / 2 + 4, height: stroke + 70, segments: 20, hollow: bore / 2 }, ghost(C.steel), { parent: block, pos: [at(r + rodLen + 10)[0], at(r + rodLen + 10)[1] - 30, at(r + rodLen + 10)[2]], rot, explode: [dir[0] * 40, dir[1] * 40, dir[2] * 40] })
      const piston = a.add(`piston-${n}`, `Piston ${n}`, 'Driven down by combustion pressure; follows the crank pin through the connecting rod.', { type: 'cylinder', radius: bore / 2 - 2, height: 52, segments: 20 }, wire(C.light), { rot, anim: { type: 'crank', crank, pin: pinLocal, direction: dir, rod: rodLen }, explode: [dir[0] * 160, dir[1] * 160, dir[2] * 160] })
      a.add(`rings-${n}`, `Piston rings ${n}`, 'Spring-steel rings that seal compression and scrape oil off the bore.', { type: 'torus', radius: bore / 2 - 2, tube: 2.5, segments: 24 }, wire(C.yellow), { parent: piston, pos: [0, 18, 0] })
      a.add(`rod-${n}`, `Connecting rod ${n}`, 'Links piston to crank pin; its swing turns linear force into torque.', { type: 'box', size: [14, rodLen, 22] }, wire(C.cyan), { anim: { type: 'rod', piston }, explode: [dir[0] * 90, dir[1] * 90, dir[2] * 90] })
      const head = at(r + rodLen + 70)
      const chamber = a.add(`chamber-${n}`, `Combustion chamber ${n}`, 'Where the compressed charge burns; the flash shows each cylinder\u2019s power stroke in firing order.', { type: 'cylinder', radius: bore / 2 - 4, height: 14, segments: 18 }, glow(C.orange, { effect: 'fire', effectTarget: [0, -1, 0], pulse: { driver: crank, ratio: 0.5, phase: half, width: 70 } }), { parent: block, pos: [head[0], head[1] - 30, head[2]], rot, explode: [dir[0] * 200, dir[1] * 200, dir[2] * 200] })
      a.add(`plug-${n}`, `Spark plug ${n}`, 'Fires a spark just before top dead centre to light the mixture.', { type: 'cylinder', radius: 6, height: 40, segments: 8 }, wire(C.light, { effect: 'electric', effectTarget: [0, -38, 0], pulse: { driver: crank, ratio: 0.5, phase: (half + 355) % 360, width: 18 } }), { parent: chamber, pos: [0, 40, 0], explode: [0, 60, 0] })
      for (const [k, kind] of [[0, 'Intake'], [1, 'Exhaust']] as const) {
        const side = k === 0 ? -1 : 1
        // Exhaust opens near the end of power (+80° of the half-speed cycle), intake around +175°.
        const phase = -(half + (k === 0 ? 175 : 80))
        const valve = a.add(`${kind.toLowerCase()}-valve-${n}`, `${kind} valve ${n}`, k === 0 ? 'Opens to let fresh air-fuel charge in on the intake stroke.' : 'Opens near the end of the power stroke to let burned gas out.', { type: 'lathe', points: [[0, -38], [17, -36], [17, -33], [4, -24], [4, 30], [0, 30]], segments: 12 }, wire(k === 0 ? C.blue : C.red), { parent: chamber, pos: [side * bore * 0.2, 18, 0], anim: { type: 'oscillate', axis: [0, -1, 0], amplitude: 10, frequency: 0.5, driver: crank, mode: 'translate', wave: 'cam', phase }, explode: [side * 30, 90, 0] })
        a.add(`${kind.toLowerCase()}-spring-${n}`, `${kind} valve spring ${n}`, 'Helical spring that snaps the valve shut when the cam lobe passes.', { type: 'spring', radius: 9, wire: 1.6, turns: 6, height: 34 }, wire(C.green), { parent: valve, pos: [0, 12, 0] })
      }
    }
  }
  // Heads per bank.
  for (let b = 0; b < bankCount; b++) {
    const alpha = banks[b]!, ar = (alpha * Math.PI) / 180
    const d = r + rodLen + 95
    a.add(`head-${b + 1}`, bankCount === 2 ? `Cylinder head ${b === 0 ? 'A' : 'B'}` : 'Cylinder head', 'Caps the cylinders and carries the valves, springs and spark plugs.', { type: 'box', size: [length, 70, bore + 50] }, ghost(C.blue), { parent: block, pos: [0, Math.cos(ar) * d - 30, Math.sin(ar) * d], rot: [alpha, 0, 0], explode: [0, Math.cos(ar) * 260, Math.sin(ar) * 260] })
    const manifold: Vec3[] = []
    for (let i = 0; i < pins; i++) manifold.push([x0 + i * pitch, Math.cos(ar) * (d + 10) - 30 + 20, Math.sin(ar) * (d + 10) + (bankCount === 2 ? Math.sign(alpha) : 1) * (bore / 2 + 50)])
    manifold.push([length / 2 + 60, manifold[manifold.length - 1]![1] - 120, manifold[manifold.length - 1]![2]])
    a.add(`exhaust-${b + 1}`, bankCount === 2 ? `Exhaust manifold ${b === 0 ? 'A' : 'B'}` : 'Exhaust manifold', 'Collects hot exhaust pulses from each port and routes them to the tailpipe.', { type: 'pipe', path: manifold, radius: 14 }, wire(C.red, { effect: 'smoke', effectTarget: [0, 1, 0] }), { parent: block, explode: [0, 40, (bankCount === 2 ? Math.sign(alpha) : 1) * 160] })
  }
  a.add('alternator', 'Alternator', 'Belt-driven generator that charges the battery and powers the ignition.', { type: 'cylinder', radius: 38, height: 60, segments: 18 }, wire(C.steel), { parent: block, pos: [-length / 2 - 70, 170, bankCount === 2 ? 0 : 110], rot: [0, 0, 90], anim: { type: 'rotate', axis: [0, 1, 0], drivenBy: crank, ratio: 2.4 }, explode: [-160, 60, 0] })
  a.add('crank-pulley', 'Crank pulley', 'Drives the accessory belt from the nose of the crankshaft.', { type: 'cylinder', radius: 60, height: 22, segments: 24, hollow: 16 }, wire(C.steel), { parent: crank, pos: [-length / 2 - 75, 0, 0], rot: [0, 0, 90], explode: [-120, 0, 0] })
  a.connections.push({ from: 'crank-pulley', to: 'alternator', type: 'belt', radiusFrom: 60, radiusTo: 30, color: C.gray })
  void meshPhase; void solid

  const label = o.name ?? (o.layout === 'v' ? `V${cyl} engine` : o.layout === 'flat' ? `Flat-${cyl} boxer engine` : cyl === 1 ? 'Single-cylinder engine' : `Inline-${cyl} engine`)
  return a.spec({ name: label, description: `A four-stroke ${label.toLowerCase()} driven from one crankshaft: pistons, cams, valves and firing pulses all stay in sync.`, unit: 'mm', camera: { view: 'iso', yaw: 0.45, zoom: 1 }, ...(o.prompt ? { prompt: o.prompt } : {}) }, 1500)
}
