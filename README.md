# gpuix-apps

This repository contains twelve apps built with [GPUIX](https://github.com/remorses/gpuix) (React on Zed's GPUI, painted with Metal). Each app has its own folder at `gpuix/<slug>/`. See [`gpuix/README.md`](gpuix/README.md) for the full details of each app.

Each app is wired to a one-word shell shortcut in `~/.zshrc` (also `bun link`ed into `~/.bun/bin`). Run them in Ghostty or kitty:

| Command | What it is | Try it |
| --- | --- | --- |
| `caustic` | Real-time water caustics sim | `caustic -s lagoon` |
| `convt` | Local file converter GUI | `convt gpuix/convt/demo` |
| `couch` | 10-foot media center | `couch ~/Movies` |
| `devin-tui` | Devin web app as a TUI | `devin-tui --demo` |
| `krieg` | Procedural FPS | `krieg` |
| `photocraft` | Photoshop-style image editor | `photocraft gpuix/photocraft/samples/lake.jpg` |
| `sinkhole` | DNS ad-blocker + live dashboard | `sinkhole` |
| `surf` | Real web browser (headless Chrome) | `surf https://news.ycombinator.com` |
| `tokscope` | Agent transcript token audit | `tokscope gpuix/tokscope/sample/` |
| `tradeterm` | Crypto charting + backtesting | `tradeterm BTC-USD 1h` |
| `wasteland` | Post-apocalyptic RPG | `wasteland` |
| `yard` | Miller-column file manager GUI | `yard` |
