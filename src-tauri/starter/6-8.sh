#!/bin/zsh
# Everything at once: a supernova, fireworks, then confetti.
afplay /System/Library/Sounds/Hero.aiff &
~/.touchroute/bin/touchroute fx supernova
sleep 1.2
~/.touchroute/bin/touchroute fx fireworks
sleep 2.5
~/.touchroute/bin/touchroute fx confetti "GRAND FINALE"
wait
