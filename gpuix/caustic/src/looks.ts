/** Scene presets: lighting, water optics and floor. Colours are linear RGB. */
export type RGB = readonly [number, number, number]
export type LookName = 'pool' | 'lagoon' | 'sunset' | 'night'

export interface Look {
  name: LookName
  label: string
  /** Sun (or moon) radiance. */
  sun: RGB
  skyZenith: RGB
  skyHorizon: RGB
  /** Beer–Lambert absorption per world unit. */
  absorb: RGB
  /** In-scattered water colour. */
  scatter: RGB
  floor: 'tiles' | 'sand'
  floorTint: RGB
  wallTint: RGB
  /** Sky fill light under water. */
  ambient: number
  /** Underwater wall lamps (night). 0 = off. */
  lamps: number
  /** Defaults the preset applies to the settings. */
  elev: number
  az: number
  swell: number
  depth: number
}

export const LOOK_NAMES: LookName[] = ['pool', 'lagoon', 'sunset', 'night']

export const LOOKS: Record<LookName, Look> = {
  pool: {
    name: 'pool', label: 'noon pool', sun: [1.05, 1.02, 0.96], skyZenith: [0.02, 0.035, 0.07], skyHorizon: [0.12, 0.16, 0.22],
    absorb: [1.7, 0.5, 0.28], scatter: [0.003, 0.04, 0.08], floor: 'tiles', floorTint: [0.62, 0.8, 0.9], wallTint: [0.6, 0.76, 0.88],
    ambient: 0.03, lamps: 0, elev: 64, az: 28, swell: 0.55, depth: 1,
  },
  lagoon: {
    name: 'lagoon', label: 'lagoon', sun: [1.1, 1.04, 0.92], skyZenith: [0.03, 0.06, 0.1], skyHorizon: [0.16, 0.22, 0.25],
    absorb: [2.0, 0.3, 0.27], scatter: [0.002, 0.055, 0.06], floor: 'sand', floorTint: [0.8, 0.7, 0.54], wallTint: [0.72, 0.64, 0.52],
    ambient: 0.035, lamps: 0, elev: 74, az: 40, swell: 0.85, depth: 0.75,
  },
  sunset: {
    name: 'sunset', label: 'golden hour', sun: [1.5, 0.78, 0.36], skyZenith: [0.03, 0.035, 0.07], skyHorizon: [0.42, 0.2, 0.09],
    absorb: [1.25, 0.46, 0.32], scatter: [0.025, 0.045, 0.06], floor: 'tiles', floorTint: [0.66, 0.78, 0.86], wallTint: [0.66, 0.74, 0.82],
    ambient: 0.022, lamps: 0, elev: 38, az: 300, swell: 0.6, depth: 0.85,
  },
  night: {
    name: 'night', label: 'night swim', sun: [0.34, 0.42, 0.6], skyZenith: [0.003, 0.005, 0.012], skyHorizon: [0.015, 0.022, 0.04],
    absorb: [1.3, 0.34, 0.22], scatter: [0.0, 0.04, 0.05], floor: 'tiles', floorTint: [0.62, 0.8, 0.9], wallTint: [0.6, 0.76, 0.88],
    ambient: 0.008, lamps: 1, elev: 70, az: 28, swell: 0.45, depth: 1,
  },
}

/** Underwater lamps for the night scene: position on a wall (water space) and colour. */
export const LAMPS: { x: number; y: number; z: number; c: RGB }[] = [
  { x: -1, y: -0.55, z: 0.0, c: [0.55, 1.0, 1.1] },
  { x: 0.0, y: -0.55, z: -1, c: [0.55, 1.0, 1.1] },
]
