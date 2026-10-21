import { render } from '@gpuix/react'
import { anthropicStreamer, anthropicTitler } from './src/anthropic'
import { ClaudeDesk, windowKeys } from './src/ClaudeDesk'
import { storeFile } from './src/store'

export { ClaudeDesk }

if (import.meta.main) {
  const started = performance.now()
  render(<ClaudeDesk storePath={storeFile()} streamer={anthropicStreamer} titler={anthropicTitler} />, {
    title: 'Claude Desk',
    appName: 'Claude Desk',
    appId: 'dev.gpuix.claude-desk',
    width: Number(process.env.CLAUDE_DESK_WIDTH ?? 1280),
    height: Number(process.env.CLAUDE_DESK_HEIGHT ?? 820),
    minWidth: 860,
    minHeight: 560,
    titlebarTransparent: true,
    windowBackground: 'opaque',
    trafficLightX: 16,
    trafficLightY: 18,
    focus: process.env.GPUIX_BACKGROUND !== '1',
    debugFrameOverlay: process.env.CLAUDE_DESK_DEBUG_OVERLAY === '1' ? 'full' : undefined,
    onKeyDown: (event) => windowKeys.current?.(event),
  })
  if (process.env.CLAUDE_DESK_LOG_STARTUP === '1') {
    setTimeout(() => console.log(`[claude-desk] render() returned after ${Math.round(performance.now() - started)} ms`), 0)
  }
}
