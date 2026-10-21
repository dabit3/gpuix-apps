/**
 * Real macOS metrics. Every number in the app comes from here: per-core CPU
 * from `os.cpus()` deltas, memory from `vm_stat` + `sysctl`, network from
 * `netstat -ib` deltas, disk from the IOBlockStorageDriver byte counters
 * (`ioreg`, which splits read and write; `iostat` on macOS only reports a
 * combined MB/s), load and uptime from `os`, power/thermal from `pmset`, and
 * the process table from `ps`.
 */

import os from 'node:os'
import { spawn, type ChildProcess } from 'node:child_process'

export interface CpuCore {
  user: number
  system: number
  total: number
}

export interface MemoryInfo {
  total: number
  used: number
  app: number
  wired: number
  compressed: number
  cached: number
  free: number
  swapUsed: number
  swapTotal: number
  /** 0-100, from kern.memorystatus_level (100 - free level). */
  pressure: number
}

export interface ProcessInfo {
  pid: number
  ppid: number
  cpu: number
  rss: number
  user: string
  name: string
}

export interface PowerInfo {
  source: string
  battery: number | null
  charging: boolean
  thermal: string
}

export interface Overhead {
  cpu: number
  rss: number
  heap: number
  frameP90: number | null
  fps: number | null
}

export interface Snapshot {
  t: number
  cores: CpuCore[]
  cpu: CpuCore
  memory: MemoryInfo | null
  netIn: number
  netOut: number
  diskRead: number
  diskWrite: number
  load: [number, number, number]
  uptime: number
  power: PowerInfo | null
  processes: ProcessInfo[]
  /** Increments each time the 1 s metrics (memory, net, disk, ps) refresh. */
  slowTick: number
}

export interface SystemInfo {
  model: string
  chip: string
  osVersion: string
  cores: number
  memory: number
  hostname: string
}

export interface ProcessDetail {
  pid: number
  ppid: number
  user: string
  started: string
  elapsed: string
  command: string
}

export interface DataSource {
  info: SystemInfo
  subscribe(listener: (snapshot: Snapshot) => void): () => void
  latest(): Snapshot | null
  detail(pid: number): Promise<ProcessDetail | null>
  kill(pid: number): Promise<{ ok: boolean; error?: string }>
  startStress(workers: number): number[]
  stopStress(): void
  stressPids(): number[]
  stop(): void
}

export function run(cmd: string, args: string[], timeoutMs = 4000): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let child: ChildProcess
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      resolve('')
      return
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => (out += chunk))
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out)
    })
  })
}

// ---------- parsers (pure, unit-tested) ----------

export function parseVmStat(text: string): Record<string, number> & { pageSize: number } {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1] ?? 16384)
  const out: Record<string, number> & { pageSize: number } = { pageSize }
  for (const line of text.split('\n')) {
    const m = /^"?([^":]+)"?:\s+(\d+)\.?$/.exec(line.trim())
    if (m) out[m[1]!.trim()] = Number(m[2])
  }
  return out
}

export function parseSwap(text: string): { used: number; total: number } {
  const unit = (v: string, u: string) => Number(v) * (u === 'G' ? 1024 ** 3 : u === 'K' ? 1024 : 1024 ** 2)
  const total = /total = ([\d.]+)([KMG])/.exec(text)
  const used = /used = ([\d.]+)([KMG])/.exec(text)
  return {
    total: total ? unit(total[1]!, total[2]!) : 0,
    used: used ? unit(used[1]!, used[2]!) : 0,
  }
}

export function memoryFrom(vm: ReturnType<typeof parseVmStat>, total: number, level: number, swap: { used: number; total: number }): MemoryInfo {
  const p = vm.pageSize
  const pages = (k: string) => (vm[k] ?? 0) * p
  const anonymous = pages('Anonymous pages')
  const purgeable = pages('Pages purgeable')
  const app = Math.max(0, anonymous - purgeable)
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor')
  const cached = pages('File-backed pages') + purgeable
  const used = app + wired + compressed
  return {
    total,
    used,
    app,
    wired,
    compressed,
    cached,
    free: Math.max(0, total - used - cached),
    swapUsed: swap.used,
    swapTotal: swap.total,
    pressure: Math.max(0, Math.min(100, 100 - level)),
  }
}

/** Sum of Ibytes/Obytes across real interfaces (one `<Link#>` row each, loopback excluded). */
export function parseNetstat(text: string): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/)
    if (cols.length < 10 || !cols[2]?.startsWith('<Link#')) continue
    if (cols[0]!.startsWith('lo')) continue
    // With a MAC address there are 11 columns, without one 10.
    const hasAddr = cols.length >= 11
    const ib = Number(cols[hasAddr ? 6 : 5])
    const ob = Number(cols[hasAddr ? 9 : 8])
    if (Number.isFinite(ib)) rx += ib
    if (Number.isFinite(ob)) tx += ob
  }
  return { rx, tx }
}

export function parseIoreg(text: string): { read: number; write: number } {
  let read = 0
  let write = 0
  for (const m of text.matchAll(/"Bytes \(Read\)"=(\d+)/g)) read += Number(m[1])
  for (const m of text.matchAll(/"Bytes \(Write\)"=(\d+)/g)) write += Number(m[1])
  return { read, write }
}

export function parsePs(text: string): ProcessInfo[] {
  const out: ProcessInfo[] = []
  for (const line of text.split('\n').slice(1)) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!m) continue
    out.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      rss: Number(m[4]) * 1024,
      user: m[5]!,
      name: m[6]!,
    })
  }
  return out
}

export function parsePmset(batt: string, therm: string): PowerInfo {
  const source = /drawing from '([^']+)'/.exec(batt)?.[1] ?? 'Unknown'
  const pct = /(\d+)%/.exec(batt)
  const charging = /charging|charged|AC attached/i.test(batt) && !/discharging/i.test(batt)
  let thermal = 'Nominal'
  const speed = /CPU_Speed_Limit\s*=\s*(\d+)/.exec(therm)
  if (speed && Number(speed[1]) < 100) thermal = `Throttled ${speed[1]}%`
  else if (/warning level.*(?:moderate|heavy|serious|critical)/i.test(therm)) thermal = 'Elevated'
  return { source, battery: pct ? Number(pct[1]) : null, charging, thermal }
}

export function parseDetail(text: string): ProcessDetail | null {
  // pid ppid user lstart(5 tokens) etime command...
  const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(\S+)\s+(.*)$/.exec(text.trim().split('\n').pop() ?? '')
  if (!m) return null
  return { pid: Number(m[1]), ppid: Number(m[2]), user: m[3]!, started: m[4]!, elapsed: m[5]!, command: m[6]! }
}

// ---------- CPU deltas ----------

type CpuTimes = os.CpuInfo['times']

export function cpuDeltas(prev: CpuTimes[], next: CpuTimes[]): CpuCore[] {
  return next.map((n, i) => {
    const p = prev[i] ?? n
    const user = n.user - p.user + (n.nice - p.nice)
    const system = n.sys - p.sys + (n.irq - p.irq)
    const idle = n.idle - p.idle
    const total = user + system + idle
    if (total <= 0) return { user: 0, system: 0, total: 0 }
    return { user: (user / total) * 100, system: (system / total) * 100, total: ((user + system) / total) * 100 }
  })
}

// ---------- live source ----------

export interface LiveOptions {
  intervalMs?: number
}

export function createLiveSource({ intervalMs = 500 }: LiveOptions = {}): DataSource {
  const listeners = new Set<(s: Snapshot) => void>()
  const stress: ChildProcess[] = []
  let last: Snapshot | null = null
  let prevCpu = os.cpus().map((c) => c.times)
  let prevNet: { rx: number; tx: number; t: number } | null = null
  let prevDisk: { read: number; write: number; t: number } | null = null
  let memory: MemoryInfo | null = null
  let processes: ProcessInfo[] = []
  let power: PowerInfo | null = null
  let netIn = 0
  let netOut = 0
  let diskRead = 0
  let diskWrite = 0
  let tick = 0
  let slowTick = 0
  let stopped = false
  const totalMem = os.totalmem()

  const info: SystemInfo = {
    model: 'Mac',
    chip: os.cpus()[0]?.model ?? 'Apple silicon',
    osVersion: os.release(),
    cores: os.cpus().length,
    memory: totalMem,
    hostname: os.hostname().replace(/\.local$/, ''),
  }
  void run('sysctl', ['-n', 'hw.model', 'kern.osproductversion']).then((t) => {
    const [model, ver] = t.trim().split('\n')
    if (model) info.model = model
    if (ver) info.osVersion = `macOS ${ver}`
  })

  async function slow() {
    const [vm, sys, net, disk, ps] = await Promise.all([
      run('vm_stat', []),
      run('sysctl', ['-n', 'kern.memorystatus_level', 'vm.swapusage']),
      run('netstat', ['-ib']),
      run('ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-k', 'Statistics', '-d', '1']),
      run('ps', ['-Aco', 'pid,ppid,pcpu,rss,user,comm']),
    ])
    const now = performance.now()
    const [levelLine = '100', swapLine = ''] = sys.trim().split('\n')
    if (vm) memory = memoryFrom(parseVmStat(vm), totalMem, Number(levelLine) || 0, parseSwap(swapLine))
    if (net) {
      const n = parseNetstat(net)
      if (prevNet) {
        const dt = (now - prevNet.t) / 1000
        netIn = Math.max(0, (n.rx - prevNet.rx) / dt)
        netOut = Math.max(0, (n.tx - prevNet.tx) / dt)
      }
      prevNet = { ...n, t: now }
    }
    if (disk) {
      const d = parseIoreg(disk)
      if (prevDisk) {
        const dt = (now - prevDisk.t) / 1000
        diskRead = Math.max(0, (d.read - prevDisk.read) / dt)
        diskWrite = Math.max(0, (d.write - prevDisk.write) / dt)
      }
      prevDisk = { ...d, t: now }
    }
    if (ps) processes = parsePs(ps)
    slowTick++
  }

  async function slower() {
    const [batt, therm] = await Promise.all([run('pmset', ['-g', 'batt']), run('pmset', ['-g', 'therm'])])
    power = parsePmset(batt, therm)
  }

  let busy = false
  async function sample() {
    if (stopped || busy) return
    busy = true
    try {
      const next = os.cpus().map((c) => c.times)
      const cores = cpuDeltas(prevCpu, next)
      prevCpu = next
      if (tick % 2 === 0) await slow()
      if (tick % 20 === 0) void slower()
      tick++
      const n = cores.length || 1
      const cpu = cores.reduce(
        (a, c) => ({ user: a.user + c.user / n, system: a.system + c.system / n, total: a.total + c.total / n }),
        { user: 0, system: 0, total: 0 },
      )
      const l = os.loadavg()
      last = {
        t: Date.now(),
        cores,
        cpu,
        memory,
        netIn,
        netOut,
        diskRead,
        diskWrite,
        load: [l[0] ?? 0, l[1] ?? 0, l[2] ?? 0],
        uptime: os.uptime(),
        power,
        processes,
        slowTick,
      }
      for (const fn of listeners) fn(last)
    } finally {
      busy = false
    }
  }

  void sample()
  const timer = setInterval(sample, intervalMs)

  const cleanup = () => {
    for (const c of stress) c.kill('SIGKILL')
  }
  process.once('exit', cleanup)

  return {
    info,
    subscribe(fn) {
      listeners.add(fn)
      if (last) fn(last)
      return () => listeners.delete(fn)
    },
    latest: () => last,
    async detail(pid) {
      const text = await run('ps', ['-o', 'pid=,ppid=,user=,lstart=,etime=,command=', '-p', String(pid)])
      return parseDetail(text)
    },
    async kill(pid) {
      try {
        process.kill(pid, 'SIGTERM')
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        return { ok: false, error: code === 'EPERM' ? 'Not permitted: owned by another user' : code === 'ESRCH' ? 'Process already exited' : String(error) }
      }
      // Give it a moment, then escalate like Activity Monitor's Force Quit.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 100))
        try {
          process.kill(pid, 0)
        } catch {
          processes = processes.filter((p) => p.pid !== pid)
          return { ok: true }
        }
      }
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
      processes = processes.filter((p) => p.pid !== pid)
      return { ok: true }
    },
    startStress(workers) {
      const pids: number[] = []
      for (let i = 0; i < workers; i++) {
        // `yes > /dev/null`: a harmless busy loop we own and can quit.
        const child = spawn('yes', [], { stdio: ['ignore', 'ignore', 'ignore'] })
        child.on('exit', () => {
          const idx = stress.indexOf(child)
          if (idx >= 0) stress.splice(idx, 1)
        })
        stress.push(child)
        if (child.pid) pids.push(child.pid)
      }
      // Watchdog: if System Pulse dies without cleanup (SIGKILL, crash), the
      // workers die with it instead of pinning cores forever.
      if (pids.length) {
        const list = pids.join(' ')
        const script = `while kill -0 ${process.pid} 2>/dev/null; do a=0; for p in ${list}; do kill -0 $p 2>/dev/null && a=1; done; [ $a = 1 ] || exit 0; sleep 1; done; kill ${list} 2>/dev/null`
        spawn('/bin/sh', ['-c', script], { stdio: 'ignore', detached: true }).unref()
      }
      void slow()
      return pids
    },
    stopStress() {
      for (const c of [...stress]) c.kill('SIGTERM')
    },
    stressPids: () => stress.filter((c) => c.exitCode === null && c.pid).map((c) => c.pid!),
    stop() {
      stopped = true
      clearInterval(timer)
      cleanup()
    },
  }
}
