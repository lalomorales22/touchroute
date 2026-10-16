#!/bin/zsh
# Launch a rocket up the screen.
afplay /System/Library/Sounds/Submarine.aiff &
osascript -l JavaScript ~/.touchroute/fun/fx.js launch "🚀"
wait
