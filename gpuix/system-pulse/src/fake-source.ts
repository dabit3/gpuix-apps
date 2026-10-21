import type { CpuCore, DataSource, ProcessInfo, Snapshot } from './sampler.ts'

/**
 * Deterministic in-memory DataSource for tests. `tick()` emits one snapshot;
 * stress workers show up as `yes` processes that pin their cores.
 */
export function createFakeSource(cores = 8) {
  const listeners = new Set<(s: Snapshot) => void>()
  let t = 1_700_000_000_000
  let slowTick = 0
  let nextPid = 9000
  let stress: number[] = []
  let last: Snapshot | null = null
  const base: ProcessInfo[] = [
    { pid: 1, ppid: 0, cpu: 0.3, rss: 24e6, user: 'root', name: 'launchd' },
    { pid: 189, ppid: 1, cpu: 12.4, rss: 81e6, user: '_windowserver', name: 'WindowServer' },
    { pid: 412, ppid: 1, cpu: 3.1, rss: 612e6, user: 'devin', name: 'Safari' },
    { pid: 518, ppid: 1, cpu: 1.2, rss: 230e6, user: 'devin', name: 'Finder' },
    { pid: 733, ppid: 1, cpu: 7.8, rss: 1.4e9, user: 'devin', name: 'Xcode' },
    { pid: 901, ppid: 1, cpu: 0.6, rss: 44e6, user: 'root', name: 'mds_stores' },
  ]

  const snapshot = (): Snapshot => {
    const pinned = Math.min(cores, stress.length)
    const coreList: CpuCore[] = Array.from({ length: cores }, (_, i) =>
      i < pinned ? { user: 92, system: 6, total: 98 } : { user: 9 + (i % 3), system: 4, total: 13 + (i % 3) },
    )
    const sum = coreList.reduce((a, c) => ({ user: a.user + c.user, system: a.system + c.system }), { user: 0, system: 0 })
    const cpu = { user: sum.user / cores, system: sum.system / cores, total: (sum.user + sum.system) / cores }
    const processes = [
      ...base,
      ...stress.map((pid) => ({ pid, ppid: 4242, cpu: 99.1, rss: 1.1e6, user: 'devin', name: 'yes' })),
    ]
    return {
      t,
      cores: coreList,
      cpu,
      memory: {
        total: 16 * 2 ** 30,
        used: 9.4 * 2 ** 30,
        app: 6.1 * 2 ** 30,
        wired: 2.1 * 2 ** 30,
        compressed: 1.2 * 2 ** 30,
        cached: 3.3 * 2 ** 30,
        free: 3.3 * 2 ** 30,
        swapUsed: 0,
        swapTotal: 0,
        pressure: 21,
      },
      netIn: 182_000,
      netOut: 41_000,
      diskRead: 3.2e6,
      diskWrite: 640_000,
      load: [2.41, 1.98, 1.77],
      uptime: 3 * 86400 + 4 * 3600 + 120,
      power: { source: 'AC Power', battery: null, charging: false, thermal: 'Nominal' },
      processes,
      slowTick,
    }
  }

  const source: DataSource & { tick(n?: number): void; killed: number[] } = {
    info: { model: 'Mac16,10', chip: 'Apple M4', osVersion: 'macOS 26.6', cores, memory: 16 * 2 ** 30, hostname: 'test' },
    killed: [],
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    latest: () => last,
    async detail(pid) {
      const p = snapshot().processes.find((x) => x.pid === pid)
      return p ? { pid, ppid: p.ppid, user: p.user, started: '9:41AM', elapsed: '00:42', command: p.name === 'yes' ? 'yes' : `/Applications/${p.name}` } : null
    },
    async kill(pid) {
      if (!stress.includes(pid)) return { ok: false, error: 'Not permitted: owned by another user' }
      stress = stress.filter((p) => p !== pid)
      source.killed.push(pid)
      return { ok: true }
    },
    startStress(n) {
      stress = Array.from({ length: n }, () => nextPid++)
      return [...stress]
    },
    stopStress() {
      stress = []
    },
    stressPids: () => [...stress],
    stop() {},
    tick(n = 1) {
      for (let i = 0; i < n; i++) {
        t += 500
        if (i % 2 === 0) slowTick++
        last = snapshot()
        for (const l of listeners) l(last)
      }
    },
  }
  return source
}
