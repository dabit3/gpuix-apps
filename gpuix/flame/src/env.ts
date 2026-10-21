// Imported first by the CLI so the native addon sees it when it loads:
// gpui-terminal logs at info level, which would land in the restored shell.
process.env.RUST_LOG ||= 'warn'
