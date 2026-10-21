/** Camera math: a view is a centre (re, im) and the width `w` of the view in
 * the complex plane. Flights use van Wijk & Nuij's smooth pan-and-zoom path,
 * the same one d3.interpolateZoom uses, so long jumps zoom out, travel, and
 * dive back in. */

export interface Camera {
  re: number
  im: number
  w: number
}

export interface Bookmark {
  id: string
  name: string
  note: string
  cam: Camera
  maxIter: number
}

export const BOOKMARKS: Bookmark[] = [
  { id: 'seahorse', name: 'Seahorse Valley', note: 'Spirals between the bulbs', cam: { re: -0.7463, im: 0.1102, w: 0.005 }, maxIter: 1200 },
  { id: 'elephant', name: 'Elephant Valley', note: 'Trunks along the cardioid', cam: { re: 0.2925755, im: -0.0149977, w: 0.004 }, maxIter: 1200 },
  { id: 'minibrot', name: 'Mini Mandelbrot', note: 'Period-3 copy on the antenna', cam: { re: -1.7548776662466927, im: 0, w: 0.045 }, maxIter: 900 },
  { id: 'dendrite', name: 'Dendrite', note: 'Misiurewicz branch near c = i', cam: { re: -0.10109636, im: 0.95628651, w: 0.02 }, maxIter: 1500 },
  { id: 'feigenbaum', name: 'Feigenbaum Point', note: 'Where period doubling ends', cam: { re: -1.4011551890920506, im: 0, w: 0.000004 }, maxIter: 3000 },
  { id: 'island', name: 'Spiral Island', note: 'A minibrot in the west bulb', cam: { re: -1.25066, im: 0.02012, w: 0.0008 }, maxIter: 1500 },
  {
    id: 'abyss',
    name: 'Seahorse Abyss',
    note: 'A 10¹² × dive, at the limit of float64',
    cam: { re: -0.743643887037158704752191506114774, im: 0.131825904205311970493132056385139, w: 3e-12 },
    maxIter: 6000,
  },
]

export const HOME: Camera = { re: -0.65, im: 0, w: 3.6 }

export function homeFor(viewW: number, viewH: number): Camera {
  const aspect = viewW > 0 && viewH > 0 ? viewW / viewH : 1.4
  return { re: -0.65, im: 0, w: Math.max(3.6, 2.7 * aspect) }
}

export type CameraPath = ((t: number) => Camera) & { duration: number }

const RHO = Math.SQRT2

/** Van Wijk smooth zoom. `duration` is in seconds, scaled from path length. */
export function zoomPath(from: Camera, to: Camera, speed = 1): CameraPath {
  const ux0 = from.re
  const uy0 = from.im
  const w0 = from.w
  const ux1 = to.re
  const uy1 = to.im
  const w1 = to.w
  const dx = ux1 - ux0
  const dy = uy1 - uy0
  const d2 = dx * dx + dy * dy
  let S: number
  let fn: (t: number) => Camera
  if (d2 < 1e-30 || d2 / (w0 * w0) < 1e-12) {
    const k = Math.log(w1 / w0)
    S = Math.abs(k) / RHO
    fn = (t) => (t >= 1 ? { ...to } : { re: ux0 + t * dx, im: uy0 + t * dy, w: w0 * Math.exp(t * k) })
  } else {
    const d1 = Math.sqrt(d2)
    const b0 = (w1 * w1 - w0 * w0 + RHO ** 4 * d2) / (2 * w0 * RHO * RHO * d1)
    const b1 = (w1 * w1 - w0 * w0 - RHO ** 4 * d2) / (2 * w1 * RHO * RHO * d1)
    // log(sqrt(b² + 1) - b) cancels to log(0) for deep zooms; -asinh(b) is the stable form.
    const r0 = -Math.asinh(b0)
    const r1 = -Math.asinh(b1)
    S = (r1 - r0) / RHO
    fn = (t) => {
      const s = t * S
      const coshr0 = Math.cosh(r0)
      const u = (w0 / (RHO * RHO * d1)) * (coshr0 * Math.tanh(RHO * s + r0) - Math.sinh(r0))
      // Snap the last frame so float error cannot leave us off target.
      if (t >= 1) return { ...to }
      return { re: ux0 + u * dx, im: uy0 + u * dy, w: (w0 * coshr0) / Math.cosh(RHO * s + r0) }
    }
  }
  const path = fn as CameraPath
  path.duration = Math.min(9, Math.max(0.6, (S * 0.42) / speed))
  return path
}

/** A short eased move (arrow keys, +/-, double-click). Zoom interpolates in log space. */
export function easePath(from: Camera, to: Camera, duration: number): CameraPath {
  const lw0 = Math.log(from.w)
  const lw1 = Math.log(to.w)
  const fn = ((t: number) => {
    if (t >= 1) return { ...to }
    const w = Math.exp(lw0 + (lw1 - lw0) * t)
    // Keep the zoom anchor fixed: interpolate the centre in proportion to width change.
    const k = Math.abs(lw1 - lw0) > 1e-9 ? (from.w - w) / (from.w - to.w) : t
    return { re: from.re + (to.re - from.re) * k, im: from.im + (to.im - from.im) * k, w }
  }) as CameraPath
  fn.duration = duration
  return fn
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

export function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

/** "1.2 × 10⁶" style magnification relative to the home view. */
export function formatZoom(w: number): string {
  const z = 3.6 / w
  if (z < 1000) return `${z < 10 ? z.toFixed(2) : z.toFixed(z < 100 ? 1 : 0)}×`
  const e = Math.floor(Math.log10(z))
  const m = z / 10 ** e
  const sup = String(e)
    .split('')
    .map((ch) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(ch)])
    .join('')
  return `${m.toFixed(2)} × 10${sup}`
}

export function formatCoord(v: number, w: number): string {
  // Enough digits to tell neighbouring pixels apart at this zoom.
  const digits = Math.min(16, Math.max(4, Math.ceil(-Math.log10(w / 1000))))
  const s = v.toFixed(digits)
  return v >= 0 ? ` ${s}` : s
}
