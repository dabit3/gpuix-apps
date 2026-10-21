import { useLayoutEffect, useRef } from 'react'
import type { ImgInstance } from '@gpuix/react'
import { toRgba, type Art } from '../render/art2d'

export function ArtImg({ art, scale, width, height, testId, dim }: { art: Art; scale: number; width: number; height: number; testId?: string; dim?: number }) {
  const ref = useRef<ImgInstance>(null)
  useLayoutEffect(() => {
    const px = toRgba(art, scale, dim)
    ref.current?.setImagePixels(px.w, px.h, px.data)
  }, [art, scale, dim])
  return <img ref={ref} testId={testId} objectFit="fill" style={{ width, height }} />
}

/** Re-renders its art on an interval (map blink, radio wave). */
export function LiveArt({ make, scale, width, height, fps = 12, testId }: { make: (t: number) => Art; scale: number; width: number; height: number; fps?: number; testId?: string }) {
  const ref = useRef<ImgInstance>(null)
  const makeRef = useRef(make)
  makeRef.current = make
  useLayoutEffect(() => {
    const draw = () => { const px = toRgba(makeRef.current(performance.now()), scale); ref.current?.setImagePixels(px.w, px.h, px.data) }
    draw()
    const id = setInterval(draw, 1000 / fps)
    return () => clearInterval(id)
  }, [scale, fps])
  return <img ref={ref} testId={testId} objectFit="fill" style={{ width, height }} />
}
