import { describe, expect, it } from 'bun:test'
import { cpuDeltas, memoryFrom, parseIoreg, parseNetstat, parsePmset, parsePs, parseSwap, parseVmStat, run } from './sampler.ts'

const isMac = process.platform === 'darwin'
const mac = isMac ? it : it.skip

describe('parsers', () => {
  it('parses vm_stat and derives memory', () => {
    const vm = parseVmStat(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            200000.
Pages inactive:                          150000.
Pages speculative:                         5000.
Pages throttled:                              0.
Pages wired down:                         80000.
Pages purgeable:                           3000.
File-backed pages:                       120000.
Anonymous pages:                         235000.
Pages occupied by compressor:             40000.
`)
    expect(vm.pageSize).toBe(16384)
    const mem = memoryFrom(vm, 16 * 2 ** 30, 79, { used: 0, total: 0 })
    expect(mem.wired).toBe(80000 * 16384)
    expect(mem.compressed).toBe(40000 * 16384)
    expect(mem.used).toBeGreaterThan(mem.wired)
    expect(mem.used).toBeLessThanOrEqual(16 * 2 ** 30)
    expect(mem.pressure).toBe(21)
  })

  it('parses swap usage', () => {
    expect(parseSwap('vm.swapusage: total = 2048.00M  used = 512.50M  free = 1535.50M  (encrypted)')).toEqual({
      total: 2048 * 2 ** 20,
      used: 512.5 * 2 ** 20,
    })
  })

  it('parses ps output with spaces in command names', () => {
    const procs = parsePs(`  PID  PPID  %CPU    RSS USER             COMM
    1     0   0.3  24576 root             launchd
  412     1  12.5 614400 devin            Google Chrome Helper
`)
    expect(procs).toHaveLength(2)
    expect(procs[1]).toEqual({ pid: 412, ppid: 1, cpu: 12.5, rss: 614400 * 1024, user: 'devin', name: 'Google Chrome Helper' })
  })

  it('parses pmset battery + thermal', () => {
    const p = parsePmset(
      `Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t87%; discharging; 5:12 remaining present: true`,
      'Note: No thermal warning level has been recorded\nNote: No performance warning level has been recorded',
    )
    expect(p.source).toBe('Battery Power')
    expect(p.battery).toBe(87)
    expect(p.charging).toBe(false)
    expect(p.thermal).toBe('Nominal')
  })

  it('computes per-core deltas', () => {
    const a = [{ user: 100, nice: 0, sys: 50, idle: 850, irq: 0 }]
    const b = [{ user: 160, nice: 0, sys: 70, idle: 870, irq: 0 }]
    const [c] = cpuDeltas(a, b)
    expect(c!.user).toBeCloseTo(60)
    expect(c!.system).toBeCloseTo(20)
    expect(c!.total).toBeCloseTo(80)
  })
})

describe('real macOS counters', () => {
  mac('reads vm_stat, netstat, ioreg and ps from this machine', async () => {
    const [vm, net, io, ps] = await Promise.all([
      run('vm_stat', []),
      run('netstat', ['-ib']),
      run('ioreg', ['-c', 'IOBlockStorageDriver', '-r', '-k', 'Statistics', '-d', '1']),
      run('ps', ['-Aco', 'pid,ppid,pcpu,rss,user,comm']),
    ])
    expect(parseVmStat(vm).pageSize).toBeGreaterThan(0)
    expect(parseNetstat(net).rx).toBeGreaterThan(0)
    expect(parseIoreg(io).read).toBeGreaterThan(0)
    const procs = parsePs(ps)
    expect(procs.length).toBeGreaterThan(50)
    expect(procs.some((p) => p.pid === process.pid)).toBe(true)
  })
})
