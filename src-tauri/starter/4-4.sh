#!/bin/zsh
# Shake the magic 8 ball and show its answer.
answers=("It is certain" "Ask again later" "Don't count on it" "Yes, definitely" "Outlook not so good" "Signs point to yes" "Very doubtful" "Without a doubt")
a=${answers[$(( RANDOM % ${#answers} + 1 ))]}
say -v Whisper "$a" &
osascript -l JavaScript ~/.touchroute/fun/fx.js pop "🎱" "$a"
wait
