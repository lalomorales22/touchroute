#!/bin/zsh
# Pop a big waving hand on screen.
afplay /System/Library/Sounds/Tink.aiff &
osascript -l JavaScript ~/.touchroute/fun/fx.js pop "👋"
wait
