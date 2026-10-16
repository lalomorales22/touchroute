#!/bin/zsh
# Roll a six-sided die, show it and say it out loud.
n=$(( RANDOM % 6 + 1 ))
say -v Samantha "You rolled a $n" &
osascript -l JavaScript ~/.touchroute/fun/fx.js pop "🎲" "you rolled $n"
wait
