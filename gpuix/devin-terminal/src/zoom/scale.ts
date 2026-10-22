// App-wide zoom: the JSX runtime multiplies every pixel length in a style by `zoom`, so ⌃+ / ⌃− (⌘ in a native window) scale the whole UI the way browser zoom does.
export const ZOOM_STEPS = [0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

let zoom = 1
export const getZoom = () => zoom
export function setZoom(z: number) {
  zoom = clampZoom(z)
}
export function clampZoom(z: number) {
  return Math.min(2, Math.max(0.75, Math.round(z * 100) / 100))
}
export function stepZoom(z: number, dir: 1 | -1) {
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001)
  return next ?? z
}

const LENGTHS = new Set([
  'fontSize', 'lineHeight', 'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'flexBasis',
  'padding', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom', 'paddingX', 'paddingY',
  'margin', 'marginLeft', 'marginRight', 'marginTop', 'marginBottom', 'marginX', 'marginY',
  'gap', 'rowGap', 'columnGap', 'top', 'left', 'right', 'bottom', 'borderRadius',
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
  'offsetX', 'offsetY', 'blurRadius', 'spreadRadius', 'letterSpacing',
])

/** Scales numeric lengths (and nested hover/focus/boxShadow objects); strings like '100%' pass through. */
export function scaleStyle<T>(style: T, z = zoom): T {
  if (z === 1 || !style || typeof style !== 'object') return style
  if (Array.isArray(style)) return style.map((s) => scaleStyle(s, z)) as T
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(style as Record<string, unknown>)) {
    if (typeof v === 'number' && LENGTHS.has(k)) out[k] = Math.round(v * z * 100) / 100
    else if (v && typeof v === 'object') out[k] = scaleStyle(v, z)
    else out[k] = v
  }
  return out as T
}

export function scaleProps<P extends Record<string, unknown> | null | undefined>(props: P): P {
  if (zoom === 1 || !props) return props
  let next: Record<string, unknown> | null = null
  const s = props.style
  if (s && typeof s === 'object') next = { ...props, style: scaleStyle(s) }
  else if (typeof s === 'function') next = { ...props, style: (...a: unknown[]) => scaleStyle((s as (...x: unknown[]) => unknown)(...a)) }
  for (const k of ['sideOffset', 'gap', 'snapMargin'] as const) {
    if (typeof props[k] === 'number') next = { ...(next ?? props), [k]: (props[k] as number) * zoom }
  }
  const o = props.offset as { x?: number; y?: number } | undefined
  if (o && typeof o === 'object') next = { ...(next ?? props), offset: { x: (o.x ?? 0) * zoom, y: (o.y ?? 0) * zoom } }
  return (next ?? props) as P
}
