#!/bin/bash
# Real-input demo driver for the Ghostty recording (window at 0,180 1417x876, 1600x1200 display).
I=~/inp
OY=${OY:-120}  # window top-left is 0,$((60+OY))
k() { $I key "$@"; }
front() { [ "$(osascript -e 'tell application "System Events" to get name of first process whose frontmost is true')" = "ghostty" ] || { echo "ghostty not frontmost"; exit 1; }; }
front
sleep 1.0
$I type "wasteland"; sleep 0.3; k 36; sleep 3.0
# character creation by keyboard: shift a point from Grit to Wits
k 123; sleep 0.4; k 125; sleep 0.3; k 124; sleep 0.5; k 125; sleep 0.25; k 125; sleep 0.25; k 125; sleep 0.6
k 36; sleep 2.2
# hover the townsfolk, then talk to Overseer Ada by clicking her
$I move 424 $((413+OY)); sleep 0.8; $I move 613 $((507+OY)); sleep 0.6
$I click 613 $((507+OY)); sleep 3.0
k 18; sleep 2.6; k 18; sleep 1.2; k 53; sleep 1.2
# WRIST-LINK tabs
k 19; sleep 0.8; $I click 1091 $((238+OY)); sleep 1.0
k 21; sleep 1.1; k 20; sleep 1.2; k 23; sleep 1.1; k 18; sleep 0.4
# field manual
k 4; sleep 1.8; k 53; sleep 0.4
# scroll zoom on the map (ends zoomed out)
$I scroll 520 $((420+OY)) 3 2; sleep 1.1; $I scroll 520 $((420+OY)) -3 2; sleep 0.7
k 1 ctrl; sleep 0.6
# walk east toward the crater until the glowhounds notice
$I click 773 $((643+OY)); sleep 3.4
k 17; sleep 1.0; k 36; sleep 1.9; k 36; sleep 2.0
k 14; sleep 2.2
k 17; sleep 0.8; k 36; sleep 2.0
# split the pane and talk to the game from the shell
k 2 cmd; cliclick ku:cmd; sleep 1.3
$I type "wasteland radio \"Glowhounds at the crater\""; k 36; sleep 1.8
$I type "wasteland save"; k 36; sleep 1.8
# drag the divider both ways
$I drag 708 $((500+OY)) 940 $((500+OY)) 900; sleep 1.0; $I drag 940 $((500+OY)) 600 $((500+OY)) 1000; sleep 1.2
# back into the game pane: it still responds in compact mode
$I click 260 $((300+OY)); sleep 0.6; k 17; sleep 0.9; k 36; sleep 2.2
k 8 ctrl; sleep 2.0
