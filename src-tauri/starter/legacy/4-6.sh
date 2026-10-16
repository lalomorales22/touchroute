#!/bin/zsh
# Fetch a random dad joke, read it out and slide it across the screen.
joke=$(curl -fsS --max-time 5 -H "Accept: text/plain" https://icanhazdadjoke.com/ || echo "I would tell you a UDP joke, but you might not get it.")
say -v Fred "$joke" &
osascript -l JavaScript ~/.touchroute/fun/fx.js banner "😂 🤣" "$joke"
wait
