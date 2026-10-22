/** Float32Array on a SharedArrayBuffer, so render workers read the sim without copies. */
export function f32(n: number) {
  return typeof SharedArrayBuffer === 'function' ? new Float32Array(new SharedArrayBuffer(n * 4)) : new Float32Array(n)
}
