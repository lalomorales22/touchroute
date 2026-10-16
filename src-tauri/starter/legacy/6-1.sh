#!/bin/zsh
# Pop a trophy with a victory sound.
afplay /System/Library/Sounds/Hero.aiff &
osascript -l JavaScript ~/.touchroute/fun/fx.js pop "🏆" "you win"
wait
