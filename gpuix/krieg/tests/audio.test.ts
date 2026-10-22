import { expect, test } from 'bun:test'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Each game gets its own TMPDIR, so its song path is unique and an orphaned player is findable after the game is gone.
// A fake player stands in for afplay so the test doesn't depend on a working audio device.
const FAKE = join(import.meta.dir, 'fixtures/fake-player.sh')
const players = (dir: string) => spawnSync('pgrep', ['-f', `^/bin/sh ${FAKE} .*${join(dir, 'krieg-audio', 'song.wav')}`]).stdout.toString().split('\n').filter(Boolean).length
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const killGroup = (pid: number, sig = 'KILL') => spawnSync('/bin/kill', ['-s', sig, '--', `-${pid}`])

async function noMusicAfter(sig: string, group: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'krieg-test-'))
  const src = `import { Audio } from ${JSON.stringify(join(import.meta.dir, '../src/audio/synth'))}; const a = new Audio(true, ${JSON.stringify(FAKE)}); a.startMusic(); setInterval(() => {}, 1000)`
  const game = spawn(process.execPath, ['-e', src], { stdio: 'ignore', detached: true, env: { ...process.env, TMPDIR: dir + '/' } })
  try {
    for (let i = 0; i < 60 && !players(dir); i++) await sleep(100)
    expect(players(dir)).toBe(1)
    if (group) killGroup(game.pid!, sig)
    else spawnSync('/bin/kill', ['-s', sig, String(game.pid)])
    await sleep(1500)
    expect(players(dir)).toBe(0)
  } finally {
    killGroup(game.pid!)
    spawnSync('pkill', ['-9', '-f', join(dir, 'krieg-audio')])
  }
}

const mac = process.platform === 'darwin'
test.skipIf(!mac)('music stops on Ctrl-C (SIGINT to the whole foreground group)', () => noMusicAfter('INT', true), 15000)
test.skipIf(!mac)('music stops when the window or pane closes (SIGHUP to the group)', () => noMusicAfter('HUP', true), 15000)
test.skipIf(!mac)('music stops when only the game gets SIGHUP', () => noMusicAfter('HUP', false), 15000)
test.skipIf(!mac)('music stops when the game is killed outright (SIGKILL)', () => noMusicAfter('KILL', false), 15000)
