/**
 * Standalone-binary entry. @gpuix/native's ESM loader resolves its addon through
 * createRequire at runtime, which `bun build --compile` cannot follow, so embed the
 * .node file explicitly and point napi-rs's override variable at it before loading.
 */
import addon from '@gpuix/native-darwin-arm64/gpuix-native.darwin-arm64.node' with { type: 'file' }

process.env.NAPI_RS_NATIVE_LIBRARY_PATH ??= addon
await import('./app')
