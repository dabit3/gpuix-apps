/** Same rule as gpui-terminal: a cell taller than 24 device px means a HiDPI screen. */
export function scaleForCell(cellHeight: number): number { return cellHeight >= 24 ? 2 : 1 }

/** Parses the reply to CSI 16 t: ESC [ 6 ; height ; width t */
export function parseCellReply(s: string): { width: number; height: number } | null {
  const m = /\x1b\[6;(\d+);(\d+)t/.exec(s)
  return m ? { height: Number(m[1]), width: Number(m[2]) } : null
}

/**
 * Device pixel ratio GPUIX will use in this terminal: $GPUI_TERMINAL_SCALE, else ask the terminal for its cell size
 * (CSI 16 t, 250 ms timeout). Must run before render(), while we still own the tty.
 */
export async function detectScale(timeoutMs = 250): Promise<number> {
  const env = Number(process.env.GPUI_TERMINAL_SCALE)
  if (Number.isFinite(env) && env > 0) return env
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 1
  const stdin = process.stdin
  try {
    stdin.setRawMode(true)
    const reply = await new Promise<string>((resolve) => {
      let got = ''
      const done = () => { clearTimeout(timer); stdin.off('data', onData); resolve(got) }
      const onData = (d: Buffer) => { got += d.toString('latin1'); if (/\x1b\[6;\d+;\d+t/.test(got)) done() }
      const timer = setTimeout(done, timeoutMs)
      stdin.on('data', onData)
      process.stdout.write('\x1b[16t')
    })
    const cell = parseCellReply(reply)
    return cell ? scaleForCell(cell.height) : 1
  } catch { return 1 } finally {
    try { stdin.setRawMode(false); stdin.pause() } catch {}
  }
}
