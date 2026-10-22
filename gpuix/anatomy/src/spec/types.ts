export type Vec3 = [number, number, number]
export type Vec2 = [number, number]

export type Geometry =
  | { type: 'box'; size: Vec3 }
  | { type: 'cylinder'; radius: number; height: number; radiusTop?: number; segments?: number; hollow?: number }
  | { type: 'cone'; radius: number; height: number; segments?: number }
  | { type: 'sphere'; radius: number; segments?: number }
  | { type: 'torus'; radius: number; tube: number; segments?: number }
  | { type: 'capsule'; radius: number; height: number; segments?: number }
  | { type: 'gear'; teeth: number; module: number; pressureAngle?: number; bore?: number; thickness: number; spokes?: number }
  | { type: 'spring'; radius: number; wire: number; turns: number; height: number }
  | { type: 'pipe'; path: Vec3[]; radius: number }
  | { type: 'extrude'; points: Vec2[]; depth: number }
  | { type: 'lathe'; points: Vec2[]; segments?: number }
  | { type: 'blades'; count: number; radius: number; hub: number; chord: number; twist?: number }

export type Effect = 'fire' | 'water' | 'plasma' | 'smoke' | 'electric'

export interface Pulse {
  /** Part whose rotation drives the pulse (usually the crankshaft). */
  driver: string
  /** Pulses per driver revolution (0.5 = every other revolution, like a 4-stroke power stroke). */
  ratio: number
  /** Degrees of the pulse cycle where the effect starts. */
  phase: number
  /** Width of the pulse in degrees. */
  width: number
}

export interface Material {
  style: 'wire' | 'solid' | 'ghost' | 'glow'
  color: string
  effect?: Effect
  /** Second point (part-local) for electric arcs, or the emission direction for fire/smoke. */
  effectTarget?: Vec3
  pulse?: Pulse
}

export type Animation =
  | { type: 'rotate'; axis: Vec3; rpm?: number; drivenBy?: string; ratio?: number; phase?: number; ticks?: number }
  | {
      type: 'oscillate'
      axis: Vec3
      amplitude: number
      /** Hz, or cycles per driver revolution when `driver` is set. */
      frequency: number
      phase?: number
      driver?: string
      mode?: 'rotate' | 'translate' | 'scale'
      wave?: 'sine' | 'cam'
    }
  | { type: 'slide'; path: Vec3[]; period?: number; driver?: string; ratio?: number; phase?: number }
  | {
      type: 'crank'
      /** Rotating part that carries the crank pin. */
      crank: string
      /** Crank pin, in the crank part's local frame. */
      pin: Vec3
      /** Direction the piston travels (machine frame), away from the crank axis. */
      direction: Vec3
      /** Connecting rod length, centre to centre. */
      rod: number
    }
  | { type: 'rod'; piston: string }
  | { type: 'follow'; part: string; point: Vec3 }

export interface Part {
  id: string
  label: string
  description: string
  parentId?: string
  geometry: Geometry
  transform?: { position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  material: Material
  animation?: Animation
  /** Optional explode direction override (machine units at explode = 1). */
  explode?: Vec3
}

export interface Connection {
  from: string
  to: string
  type: 'belt' | 'chain' | 'shaft' | 'wire'
  /** Radius of the belt around `from` and `to`, for belts and chains. */
  radiusFrom?: number
  radiusTo?: number
  color?: string
  /** Wire only: lift the midpoint by this fraction of the span instead of sagging. */
  arc?: number
}

export interface Annotation {
  part: string
  text: string
}

export interface MachineSpec {
  version: 1
  meta: {
    name: string
    description: string
    unit: 'mm' | 'cm' | 'm' | 'in'
    camera?: { view?: 'iso' | 'perspective'; yaw?: number; pitch?: number; zoom?: number }
    prompt?: string
  }
  /** Bounding half-extent every part must sit inside (machine units). */
  bounds?: number
  parts: Part[]
  connections?: Connection[]
  annotations?: Annotation[]
}
