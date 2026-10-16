#!/bin/zsh
# Pop a trophy with a victory sound.
afplay /System/Library/Sounds/Hero.aiff &
~/.touchroute/bin/touchroute fx pop "🏆" "you win"
wait
