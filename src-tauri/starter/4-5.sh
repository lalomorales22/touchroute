#!/bin/zsh
# Flip a coin and show heads or tails.
(( RANDOM % 2 )) && side="Heads" || side="Tails"
afplay /System/Library/Sounds/Ping.aiff &
say -v Samantha "$side" &
osascript -l JavaScript ~/.touchroute/fun/fx.js spin "🪙" "$side"
wait
