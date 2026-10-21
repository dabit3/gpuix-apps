#!/usr/bin/env bash
# Generates the demo inputs procedurally (no third-party assets): photos, a HEIC, videos, audio and docs.
# usage: scripts/make-fixtures.sh [dir]   (default: ./demo, plus ./demo-more for files to drop in later)
set -euo pipefail
DIR="${1:-demo}"
MORE="${DIR%/}-more"
rm -rf "$DIR" "$MORE"; mkdir -p "$DIR" "$MORE"
ff() { ffmpeg -nostdin -hide_banner -loglevel error -y "$@"; }

# Photos: CPU-painted landscapes (scripts/paint.ts) with smooth skies, great for showing compression artifacts.
export PATH="$HOME/.bun/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
bun "$HERE/paint.ts" ridges 2400 1600 | ff -f image2pipe -c:v ppm -i - -q:v 1 "$DIR/alpine-sunset.jpg"
bun "$HERE/paint.ts" dunes 2048 1366 | ff -f image2pipe -c:v ppm -i - "$DIR/dunes.png"
ff -f lavfi -i "gradients=s=1600x2000:c0=0x26cd4d:c1=0x0a3069:c2=0x71b7ff:n=3:type=spiral:seed=3,format=rgb24" -frames:v 1 /tmp/convt-portrait.png
sips -s format heic -s formatOptions 80 /tmp/convt-portrait.png --out "$DIR/garden.heic" >/dev/null

# Video: a 12 s Mandelbrot zoom (1080p H.264 + a synth pad), and a short screen-recording-style clip.
ff -f lavfi -i "mandelbrot=s=1920x1080:rate=30:start_x=-0.743643887:start_y=0.131825904:start_scale=3:end_scale=0.0005:end_pts=360:inner=convergence,hue=h=-30:s=0.75" \
   -f lavfi -i "aevalsrc='0.2*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.25*t))+0.15*sin(2*PI*277.18*t)+0.12*sin(2*PI*329.63*t)':s=48000:d=12" \
   -t 12 -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest "$DIR/deep-zoom.mov"
ff -f lavfi -i "testsrc2=s=1280x720:rate=60,hue=s=0.6" -t 6 -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p "$MORE/screen-capture.mp4"

# Audio: a 16 s arpeggiated chord as an uncompressed WAV.
ff -f lavfi -i "aevalsrc='0.25*sin(2*PI*(220*pow(2,(floor(mod(t*4,4))*4)/12))*t)*exp(-12*mod(t,0.25))*(0.35+0.65*pow(sin(PI*t/8),2))+0.05*sin(2*PI*110*t)':s=48000:c=stereo:d=16" \
   -c:a pcm_s16le "$DIR/arpeggio.wav"

# Docs: Markdown, a Word document (via textutil) and a one-page PDF.
cat > "$DIR/release-notes.md" <<'MD'
# convt 0.1 release notes

Convert **images, video, audio and documents** without leaving your terminal.

## Highlights

- Formats are sniffed by *magic bytes*, not by extension
- Every engine runs locally: `ffmpeg`, `sips`, `cwebp`, `textutil`, `pandoc`
- Batch conversion uses `cores - 1` workers

## Numbers

| Input | Output | Saved |
|-------|--------|-------|
| alpine-sunset.jpg | alpine-sunset.converted.webp | 71% |
| deep-zoom.mov | deep-zoom.converted.mp4 | 64% |

> Zero network calls at runtime.
MD
pandoc "$DIR/release-notes.md" -s -o /tmp/convt-letter.html --metadata title="Quarterly letter"
textutil -convert docx /tmp/convt-letter.html -output "$DIR/quarterly-letter.docx"
sips -s format pdf "$DIR/dunes.png" --out "$MORE/brochure.pdf" >/dev/null
cp "$DIR/alpine-sunset.jpg" "$MORE/no-extension"
echo "fixtures in $DIR and $MORE:"; ls -la "$DIR" "$MORE"
