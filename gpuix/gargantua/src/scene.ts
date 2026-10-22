import type { Dive } from './dive'

export type QualityName = 'lite' | 'full'
export type LookName = 'physical' | 'interstellar'
export type SceneName = 'gargantua' | 'm87' | 'sgr-a' | 'quasar'

export interface Settings {
  quality: QualityName
  scene: SceneName
  look: LookName
  lens: boolean
  disk: boolean
  paused: boolean
  /** Disk tilt in degrees (rotation of its axis about the screen-right axis at yaw 0). */
  tilt: number
  /** log10 of the mass in solar masses. */
  mass: number
}

export interface SceneDef {
  label: string
  blurb: string
  mass: number
  look: LookName
  tilt: number
  pitch: number
  dist: number
  /** Peak disk temperature at 10⁸ M☉ (scales as M^−¼). */
  temp: number
  gain: number
  exposure: number
}

export const SCENES: Record<SceneName, SceneDef> = {
  gargantua: { label: 'Gargantua', blurb: 'Interstellar · 10⁸ M☉', mass: 8, look: 'interstellar', tilt: 0, pitch: 5, dist: 30, temp: 7000, gain: 1.0, exposure: 1.0 },
  m87: { label: 'M87*', blurb: '6.5×10⁹ M☉ · seen 17° off-axis', mass: 9.81, look: 'physical', tilt: 0, pitch: 62, dist: 34, temp: 15000, gain: 1.4, exposure: 1.1 },
  'sgr-a': { label: 'Sgr A*', blurb: 'Milky Way centre · 4.3×10⁶ M☉', mass: 6.63, look: 'physical', tilt: 0, pitch: 28, dist: 26, temp: 4200, gain: 1.1, exposure: 1.1 },
  quasar: { label: 'Quasar', blurb: '10⁹ M☉ · white-hot disk', mass: 9, look: 'physical', tilt: 0, pitch: 11, dist: 36, temp: 24000, gain: 1.5, exposure: 0.9 },
}
export const SCENE_NAMES = Object.keys(SCENES) as SceneName[]

export const DEFAULT_SETTINGS: Settings = { quality: 'lite', scene: 'gargantua', look: 'interstellar', lens: true, disk: true, paused: false, tilt: 0, mass: 8 }

export function sceneSettings(name: SceneName): Partial<Settings> {
  const s = SCENES[name]
  return { scene: name, look: s.look, tilt: s.tilt, mass: s.mass }
}

export interface Quality {
  name: QualityName
  /** Rays in the lens table. */
  rays: number
  /** Disk-plane crossings followed per pixel (image orders). */
  orders: number
  /** Render scale while the camera moves / once it settles. */
  moving: number
  still: number
}
export const QUALITY: Record<QualityName, Quality> = {
  lite: { name: 'lite', rays: 640, orders: 3, moving: 0.36, still: 0.5 },
  full: { name: 'full', rays: 1536, orders: 5, moving: 0.5, still: 0.85 },
}

export const MASS_MIN = 6
export const MASS_MAX = 10.5
export const TILT_MAX = 40
/** Simulation speed: disk time advances this many rs/c per wall second (probes run faster so a drop takes ~6 s). */
export const DISK_RATE = 9
export const PROBE_RATE = 22
export const DIST_MIN = 6
export const DIST_MAX = 120

/** Disk peak temperature for a scene at a mass: thin-disk T ∝ M^−¼. */
export const diskTemp = (scene: SceneName, mass: number) => Math.max(2200, Math.min(60000, SCENES[scene].temp * Math.pow(10, -(mass - SCENES[scene].mass) / 4)))

export interface Hud {
  r: number
  yaw: number
  pitch: number
  dive: Pick<Dive, 'phase' | 'r' | 'v' | 'tau' | 't' | 'inside'> | null
  probes: number
  /** Closest probe: radius and redshift factor. */
  probe: { r: number; g: number; stretch: number } | null
}

export const fmtMass = (m: number) => {
  const e = Math.floor(m), c = Math.pow(10, m - e)
  return `${c.toFixed(1)}×10${sup(e)} M☉`
}
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹'
export const sup = (n: number) => String(n).split('').map((d) => SUP[Number(d)] ?? d).join('')
