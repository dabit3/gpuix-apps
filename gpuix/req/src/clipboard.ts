import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { isTerminal } from '@gpuix/react'

/**
 * Copies text. In terminal mode it goes out as an OSC 52 escape straight to the
 * TTY, so it reaches the local clipboard even over SSH. GPUIX 0.11 has no
 * clipboard-write API for apps, so the native window falls back to pbcopy.
 */
export function copyText(text: string): 'osc52' | 'pbcopy' | 'none' {
  if (isTerminal()) {
    try {
      const fd = fs.openSync('/dev/tty', 'w')
      fs.writeSync(fd, `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
      fs.closeSync(fd)
      if (process.platform === 'darwin' && !process.env.SSH_CONNECTION) pbcopy(text)
      return 'osc52'
    } catch {
      // fall through
    }
  }
  if (process.platform === 'darwin') {
    pbcopy(text)
    return 'pbcopy'
  }
  return 'none'
}

function pbcopy(text: string) {
  const child = spawn('pbcopy')
  child.on('error', () => {})
  child.stdin.end(text)
}
