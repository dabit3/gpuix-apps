export type QualityName = 'lite' | 'full'

export interface Quality {
  name: QualityName
  /** Height-field grid cells per side. */
  sim: number
  /** Photons per side traced through the surface each frame. */
  photons: number
  /** Caustics texture cells per side (pool floor). */
  caustics: number
  /** Render resolution relative to the pane's pixels. */
  scale: number
  /** Separate R/G/B refraction (IOR 1.31 / 1.333 / 1.36). */
  dispersion: boolean
  /** Raymarched light shafts in the water. */
  shafts: boolean
}

export const QUALITY: Record<QualityName, Quality> = {
  lite: { name: 'lite', sim: 128, photons: 288, caustics: 192, scale: 0.7, dispersion: false, shafts: false },
  full: { name: 'full', sim: 256, photons: 400, caustics: 320, scale: 0.8, dispersion: true, shafts: true },
}

export const IOR = 1.333
export const IOR_RGB = [1.31, 1.333, 1.36] as const
/** Dispersion offsets from the base IOR for R/G/B (so the IOR slider keeps the spread). */
export const IOR_SPREAD = [IOR_RGB[0] - IOR, 0, IOR_RGB[2] - IOR] as const
