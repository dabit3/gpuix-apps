import type { GraphRow } from './graph'
import { C, LANE_COLORS } from './theme'

export const LANE_W = 14
export const ROW_H = 50
export const MAX_LANES = 9
const PAD = 12
const HALF = ROW_H / 2

const laneX = (lane: number) => PAD + lane * LANE_W
const colorOf = (c: number) => LANE_COLORS[c % LANE_COLORS.length]

const curveCache = new Map<string, string>()
function curve(dx: number, flip: boolean): string {
  const key = `${dx}:${flip}`
  let s = curveCache.get(key)
  if (!s) {
    const w = Math.abs(dx) * LANE_W + 4
    const h = HALF
    const x0 = dx > 0 ? 2 : w - 2
    const x1 = dx > 0 ? w - 2 : 2
    const [a, b] = flip ? [x1, x0] : [x0, x1]
    s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><path d="M${a} 0 C${a} ${h * 0.55} ${b} ${h * 0.45} ${b} ${h}" stroke="#000" stroke-width="2" fill="none"/></svg>`
    curveCache.set(key, s)
  }
  return s
}

export function graphWidth(lanes: number): number {
  return PAD * 2 + (Math.min(Math.max(lanes, 1), MAX_LANES) - 1) * LANE_W
}

function EdgeView({ from, to, color, top, selected }: { from: number; to: number; color: number; top: boolean; selected: boolean }) {
  const y = top ? 0 : HALF
  const stroke = selected ? '#FFFFFF' : colorOf(color)
  if (from === to) {
    return <div style={{ position: 'absolute', left: laneX(from) - 1, top: y, width: 2, height: HALF, backgroundColor: stroke }} />
  }
  const dx = to - from
  const left = Math.min(laneX(from), laneX(to)) - 2
  return (
    <svg
      source={curve(dx, false)}
      style={{ position: 'absolute', left, top: y, width: Math.abs(dx) * LANE_W + 4, height: HALF, color: stroke }}
    />
  )
}

export function GraphCell({ row, width, merge, selected }: { row: GraphRow; width: number; merge: boolean; selected: boolean }) {
  const node = colorOf(row.color)
  return (
    <div style={{ position: 'relative', width, height: ROW_H, flexShrink: 0, overflow: 'hidden' }}>
      {row.top.map((e, i) => (
        <EdgeView key={`t${i}`} from={e.from} to={e.to} color={e.color} top selected={selected} />
      ))}
      {row.bottom.map((e, i) => (
        <EdgeView key={`b${i}`} from={e.from} to={e.to} color={e.color} top={false} selected={selected} />
      ))}
      <div
        style={{
          position: 'absolute',
          left: laneX(row.lane) - 5,
          top: HALF - 5,
          width: 10,
          height: 10,
          borderRadius: 5,
          backgroundColor: merge ? (selected ? C.accent : C.pane) : node,
          borderWidth: 2,
          borderColor: selected ? '#FFFFFF' : node,
        }}
      />
    </div>
  )
}
