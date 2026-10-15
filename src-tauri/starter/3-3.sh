#!/bin/zsh
# Open Music and start playing.
open -a "Music"
sleep 2
osascript -e 'tell application "Music" to play' 2>/dev/null
