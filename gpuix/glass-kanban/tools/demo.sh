#!/bin/bash
# Real-input demo driver for the native window (window at 80,150 1440x900 on a 1600x1200 display).
# All input is real CGEvents from tools/input.swift (mouse glides/drags at 60 Hz, unicode key events).
# CAL=1 writes a screenshot after each phase for calibration.
set -u
cd "$(dirname "$0")/.."
export PATH=$HOME/.bun/bin:/opt/homebrew/bin:$PATH
DATA=${GLASS_KANBAN_DATA:-/tmp/gk-demo.json}
export GLASS_KANBAN_DATA=$DATA
IN=/tmp/gkinput
[ -x $IN ] || swiftc -O tools/input.swift -o $IN
shot() { [ "${CAL:-0}" = 1 ] && screencapture -x -R 80,150,1440,900 "/tmp/cal-$1.png"; true; }
launch() { : > /tmp/gk-demo.log; (nohup bun app.tsx > /tmp/gk-demo.log 2>&1 &); for i in $(seq 1 100); do grep -q 'mount complete' /tmp/gk-demo.log 2>/dev/null && break; sleep 0.1; done; sleep 0.5; }
quit_app() { kill $(pgrep -f "[b]un app.tsx") 2>/dev/null; sleep 0.6; }
t() { $IN "$1" "${2:-38}"; }
key() { $IN --key "$@"; }   # keycodes: 36 return, 53 esc, 125 down, 0 a, 6 z, 8 c, 40 k
click() { $IN --click "$1" "$2"; sleep "${3:-0.3}"; }
mv() { $IN --move "$1" "$2" "${3:-350}"; sleep "${4:-0.1}"; }
drag() { $IN --drag "$@"; }   # x1 y1 x2 y2 ms hold
pause() { sleep "$1"; }

if [ "${SKIP_LAUNCH:-0}" != 1 ]; then quit_app; rm -f "$DATA"; launch; fi
[ -n "${READY_FILE:-}" ] && touch "$READY_FILE"
mv 760 500 300 0.5; mv 240 330 400; mv 540 450 350; mv 840 560 350; mv 1140 420 350 0.2

# A: Todo -> In Review
drag 540 687 1140 560 1100 350; pause 0.9; shot A
# B: reorder within Todo, FIN-119 to the top
drag 540 691 540 300 800 350; pause 0.9; shot B
[ "${STOP_AT:-}" = B ] && exit 0

# C: detail sheet
click 540 340 0.9; shot C1
click 1260 266 0.25; key 0 cmd; pause 0.2
t "Crash when rotating during Face ID prompt on iPad"; pause 0.2; key 36; pause 0.5
click 1342 487 0.4; t "Perf" 70; pause 0.4; key 125; pause 0.25; key 36; pause 0.5; key 53; pause 0.4; shot C2
click 1260 379 0.6; key 125; pause 0.2; key 125; pause 0.2; key 36; pause 0.7; shot C3
click 1408 576 0.4; click 1300 659 0.3; key 0 cmd; pause 0.2
t $'## Repro\n1. Open **Transfers** on iPad\n2. Rotate while Face ID is prompting\n\nCrash in `BiometricGate.present()`' 30; pause 0.4; shot C4
click 1468 576 1.1; shot C5
[ "${STOP_AT:-}" = C ] && exit 0
click 1200 917 0.3; t "Repro'd on iPad Air, fix incoming"; pause 0.3; key 36; pause 1.0; shot C6
click 1493 225 0.9; shot C7

# D: command palette filter
key 40 cmd; pause 0.6; t "label: bug" 70; pause 0.6; shot D1; key 36; pause 1.8; shot D2
key 40 cmd; pause 0.5; t "clear" 70; pause 0.4; key 36; pause 1.0

# E: quick add + undo/redo
key 8; pause 0.6; t "Biometric re-auth for large transfers"; pause 0.4; shot E1; key 36; pause 1.3; shot E2
key 6 cmd; pause 1.2; shot F1; key 6 cmdshift; pause 1.2; shot F2

# G: reorder columns, In Review to the front
drag 1060 272 120 272 1300 400; pause 1.1; shot G
# H: auto-scroll while dragging toward the right edge
drag 240 340 1480 560 1000 2600; pause 1.1; shot H
[ "${STOP_AT:-}" = H ] && exit 0

# I: restart, state persists
quit_app; pause 1.0; launch; pause 0.6; shot I
mv 540 340 500 0.3; mv 900 520 600 1.2
