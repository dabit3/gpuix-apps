import { render } from '@gpuix/react'
import { App, keyBridge, type AppProps } from './App'

export function start(props: AppProps, opts: { terminal: boolean; background: boolean }) {
  render(<App {...props} />, {
    title: 'testdeck',
    width: 1440,
    height: 900,
    minWidth: 560,
    minHeight: 420,
    titlebarTransparent: true,
    trafficLightX: 18,
    trafficLightY: 20,
    terminal: opts.terminal,
    focus: !opts.background,
    onKeyDown(event, renderer) {
      keyBridge.current?.(event, renderer)
    },
  })
}
