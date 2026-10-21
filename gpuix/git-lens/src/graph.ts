import type { Commit } from './git'

/** One edge drawn inside half of a row. Lanes are column indices. */
export interface Edge {
  from: number
  to: number
  color: number
}

export interface GraphRow {
  lane: number
  color: number
  /** Edges in the top half: from lane at the row's top edge to lane at the node line. */
  top: Edge[]
  /** Edges in the bottom half: from lane at the node line to lane at the row's bottom edge. */
  bottom: Edge[]
}

export interface Graph {
  rows: GraphRow[]
  width: number
}

/**
 * Classic lane assignment over a topologically ordered history. Each lane holds
 * the sha it is waiting for; a commit takes the first lane that waits for it,
 * merges every other lane waiting for it, then hands its lane to its first parent.
 */
export function buildGraph(commits: Commit[]): Graph {
  const lanes: (string | null)[] = []
  const laneColor: number[] = []
  let nextColor = 0
  let width = 0
  const rows: GraphRow[] = []

  for (const commit of commits) {
    const top: Edge[] = []
    let lane = lanes.indexOf(commit.sha)
    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) lane = lanes.length
      lanes[lane] = commit.sha
      laneColor[lane] = nextColor++
    } else {
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] === null) continue
        top.push({ from: i, to: lanes[i] === commit.sha ? lane : i, color: laneColor[i] })
      }
    }
    if (top.length === 0) {
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i] !== null && i !== lane) top.push({ from: i, to: i, color: laneColor[i] })
      }
    }
    const color = laneColor[lane]
    for (let i = 0; i < lanes.length; i++) {
      if (i !== lane && lanes[i] === commit.sha) lanes[i] = null
    }

    const [first, ...rest] = commit.parents
    lanes[lane] = first ?? null
    const bottom: Edge[] = []
    const branchTargets = new Map<number, number>()
    for (const parent of rest) {
      let target = lanes.indexOf(parent)
      if (target === -1) {
        target = lanes.indexOf(null)
        if (target === -1) target = lanes.length
        lanes[target] = parent
        laneColor[target] = nextColor++
      }
      branchTargets.set(target, laneColor[target])
    }
    // A first parent already awaited by another lane folds into that lane.
    if (first) {
      const existing = lanes.findIndex((s, i) => s === first && i !== lane)
      if (existing !== -1) {
        lanes[lane] = null
        branchTargets.set(existing, laneColor[existing])
      }
    }
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i] === null) continue
      if (i === lane) bottom.push({ from: lane, to: lane, color })
      else if (branchTargets.has(i)) bottom.push({ from: lane, to: i, color: branchTargets.get(i)! })
      else bottom.push({ from: i, to: i, color: laneColor[i] })
    }
    for (const [target, c] of branchTargets) {
      if (lanes[target] === null) bottom.push({ from: lane, to: target, color: c })
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop()
    width = Math.max(width, lane + 1, lanes.length)
    rows.push({ lane, color, top, bottom })
  }
  return { rows, width }
}
