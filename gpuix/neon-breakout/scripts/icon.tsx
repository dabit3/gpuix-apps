/** Paints the app icon with GPUIX itself (GPU test renderer) and writes assets/icon-1024.png. */
import { createTestRoot } from '@gpuix/react/testing'
import { COLORS, glow, shade, vgrad } from '../src/ui/theme'

const S = 1024
const rows = [COLORS.pink, COLORS.amber, COLORS.teal]

function Icon() {
  return (
    <div style={{ width: S, height: S, position: 'relative', backgroundColor: '#00000000' }}>
      <div style={{ position: 'absolute', left: 100, top: 100, width: 824, height: 824, borderRadius: 185, background: vgrad('#101a2e', '#04060c'), borderWidth: 6, borderColor: '#2ee6d640', boxShadow: [glow(COLORS.teal, 60, '30')] }}>
        {rows.map((color, r) =>
          [0, 1, 2, 3].map((c) => (
            <div key={`${r}-${c}`} style={{ position: 'absolute', left: 120 + c * 150, top: 170 + r * 78, width: 132, height: 58, borderRadius: 14, background: vgrad(shade(color, 0.3), shade(color, -0.3)), boxShadow: [glow(color, 34, '88')] }}>
              <div style={{ position: 'absolute', left: 14, top: 9, width: 104, height: 10, borderRadius: 5, backgroundColor: '#ffffff55' }} />
            </div>
          )),
        )}
        <div style={{ position: 'absolute', left: 420, top: 520, width: 64, height: 64, borderRadius: 32, backgroundColor: '#ffffff', boxShadow: [glow(COLORS.teal, 30, 'ee', 4), glow(COLORS.teal, 80, '66', 10)] }} />
        <div style={{ position: 'absolute', left: 262, top: 660, width: 300, height: 44, borderRadius: 22, background: vgrad(shade(COLORS.teal, 0.3), shade(COLORS.teal, -0.3)), boxShadow: [glow(COLORS.teal, 50, '99')] }} />
      </div>
    </div>
  )
}

// The test renderer has no alpha, so paint a matching mask and merge it with ffmpeg.
function Mask() {
  return (
    <div style={{ width: S, height: S, position: 'relative', backgroundColor: '#000000' }}>
      <div style={{ position: 'absolute', left: 100, top: 100, width: 824, height: 824, borderRadius: 185, backgroundColor: '#ffffff' }} />
    </div>
  )
}

const out = (name: string) => new URL(`../assets/${name}`, import.meta.url).pathname
for (const [Comp, file] of [[Icon, 'icon-rgb.png'], [Mask, 'icon-mask.png']] as const) {
  const { render, renderer } = createTestRoot({ width: S, height: S })
  render(<Comp />)
  renderer.captureScreenshot(out(file))
}
const ff = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-i', out('icon-rgb.png'), '-i', out('icon-mask.png'), '-filter_complex', '[1:v]format=gray[a];[0:v][a]alphamerge,format=rgba', out('icon-1024.png')])
if (ff.exitCode !== 0) throw new Error(ff.stderr.toString())
for (const f of ['icon-rgb.png', 'icon-mask.png']) Bun.spawnSync(['rm', out(f)])
console.log('wrote assets/icon-1024.png')
