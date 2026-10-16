#!/bin/zsh
# Flip a coin and show heads or tails.
(( RANDOM % 2 )) && side="Heads" || side="Tails"
afplay /System/Library/Sounds/Ping.aiff &
say -v Samantha "$side" &
~/.touchroute/bin/touchroute fx spin "🪙" "$side"
wait
