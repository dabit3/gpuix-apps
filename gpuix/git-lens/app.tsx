import { render } from '@gpuix/react'
import { App, keyBridge } from './src/App'

const startedAt = performance.now()
const repoArg = process.argv[2] ?? process.env.GIT_LENS_REPO

render(
  <App
    initialRepo={repoArg}
    onOpened={(s) => console.log(`[git-lens] first history ready ${Math.round(performance.now())} ms after process start (module eval at ${Math.round(startedAt)} ms), ${s.commits} commits`)}
  />,
  {
    title: 'Git Lens',
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 640,
    titlebarTransparent: true,
    trafficLightX: 18,
    trafficLightY: 20,
    focus: process.env.GPUIX_BACKGROUND !== '1',
    onKeyDown(event, renderer) {
      keyBridge.current?.(event, renderer)
    },
  },
)

if (process.env.GIT_LENS_PERF === '1') {
  setInterval(() => {}, 1 << 30)
}
