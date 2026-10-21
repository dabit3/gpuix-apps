#!/bin/bash
# Real-input demo driver for the Ghostty recording (window at 0,180 1417x876, 1600x1200 display).
I=~/inp
OY=${OY:-120}  # window top-left is 0,$((60+OY))
k() { $I key "$@"; }
front() { [ "$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true')" = "ghostty" ] || { echo "ghostty not frontmost"; exit 1; }; }
front
sleep 1.5
$I type "wasteland"; sleep 0.4; k 36; sleep 2.4
# character creation with the mouse
$I click 438 $((451+OY)); sleep 0.5; $I click 506 $((611+OY)); sleep 0.5; $I click 506 $((611+OY)); sleep 0.4; $I click 438 $((451+OY)); sleep 0.5
$I click 869 $((483+OY)); sleep 1.0
$I click 634 $((707+OY)); sleep 2.0
# talk to Overseer Ada by clicking her
$I click 583 $((512+OY)); sleep 2.8
k 18; sleep 2.2; k 18; sleep 1.2; k 53; sleep 0.8
# WRIST-LINK tabs
k 19; sleep 1.0; $I click 1091 $((214+OY)); sleep 1.0; $I click 1091 $((238+OY)); sleep 1.2
k 21; sleep 1.2; k 20; sleep 1.6; k 23; sleep 1.3; k 18; sleep 0.6
# scroll zoom on the map
$I scroll 520 $((420+OY)) 3 2; sleep 1.4; $I scroll 520 $((420+OY)) -3 2; sleep 1.0
k 1 ctrl; sleep 1.0
# walk east toward the crater until the glowhounds notice
$I click 773 $((643+OY)); sleep 3.4
k 17; sleep 1.2; k 36; sleep 1.7; k 36; sleep 1.9
k 14; sleep 2.2
k 17; sleep 0.9; k 36; sleep 1.8
# split the pane and talk to the game from the shell
k 2 cmd; cliclick ku:cmd; sleep 1.6
$I type "wasteland radio \"Glowhounds at the crater\""; k 36; sleep 1.8
$I type "wasteland save"; k 36; sleep 2.0
# drag the divider both ways
$I drag 708 $((500+OY)) 940 $((500+OY)) 900; sleep 1.2; $I drag 940 $((500+OY)) 520 $((500+OY)) 1000; sleep 1.4
# back into the game pane: it still responds in compact mode
$I click 260 $((300+OY)); sleep 0.8; k 17; sleep 1; k 36; sleep 2; k 48; sleep 1.6; k 48; sleep 1
k 8 ctrl; sleep 2.0
