#!/usr/bin/env bash
# Drives the demo in Ghostty with real CGEvent input while ffmpeg records the screen.
# Assumes: Ghostty window at 0,30 (157x42 cells @ 15pt), shell prompt in gpuix/convt, no split.
set -euo pipefail
cd "$(dirname "$0")/.."
I=~/bin/cginput
OUT=${1:-/tmp/convt-raw.mov}
front() { [[ "$(osascript -e 'tell application "System Events" to name of first process whose frontmost is true')" == ghostty ]] || { echo "Ghostty not frontmost" >&2; exit 1; }; }
rm -f demo/*.converted* demo/screen-capture.mp4 demo/brochure.pdf demo/no-extension
osascript -e 'tell application "Ghostty" to activate'; sleep 0.5; front
$I --move 760 700 50
ffmpeg -y -hide_banner -loglevel error -f avfoundation -framerate 60 -capture_cursor 1 -pixel_format nv12 -i "0:none" \
  -c:v h264_videotoolbox -b:v 40M "$OUT" </dev/null &
REC=$!
sleep 2.5; front
$I "convt demo -w" 85; sleep 0.5; $I --key 36; sleep 3.5
# image: format chips, quality drag, max size
$I --move 1166 216 500; sleep 0.4; $I --click 1166 216; sleep 1.8
$I --move 1324 387 500; sleep 0.3; $I --drag 1324 387 1140 387 1500 250; sleep 1.5
$I --move 1229 453 400; $I --click 1229 453; sleep 1.5
$I --click 1104 216; sleep 1.2
# dunes, then keyboard format cycling
$I --move 200 403 500; $I --click 200 403; sleep 1.5
for k in 124 124 124; do $I --key $k; sleep 0.7; done
$I --key 123; $I --key 123; $I --key 123; sleep 1
# video: preset via key 3, audio waveform, doc preview
$I --move 200 334 500; $I --click 200 334; sleep 1.6
$I --key 18; sleep 0.8; $I --key 20; sleep 1.5
$I --move 200 275 400; $I --click 200 275; sleep 1.8
$I --move 200 580 500; $I --click 200 580; sleep 1.5
# convert everything
$I "a" 60; sleep 0.6; $I --key 36; sleep 6
$I --move 200 334 500; $I --click 200 334; sleep 2.5
# split: watch-folder drop + ffprobe in the new pane
front; $I --key 2 cmd; sleep 2
$I "cp demo-more/* demo/" 70; $I --key 36; sleep 3
$I "ffprobe -v error -show_entries stream=codec_name,width,height -of compact demo/deep-zoom.converted.mp4" 45; $I --key 36; sleep 2.5
$I --move 709 500 400; $I --drag 709 500 930 500 1200 250; sleep 1.5
$I --drag 930 500 560 500 1400 250; sleep 1.8
$I --drag 560 500 709 500 800 200; sleep 1.2
# back to the app, scroll the list, quit
$I --move 300 300 500; $I --click 300 300; sleep 0.8
$I --scroll 300 300 -6 12 40; sleep 1.2
front; $I --key 8 ctrl; sleep 2.5
kill -INT $REC; wait $REC || true
