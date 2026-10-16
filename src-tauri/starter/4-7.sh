#!/bin/zsh
# Light up a neon sign and have Superstar cheer you on.
say -v Superstar "You are crushing it today" &
~/.touchroute/bin/touchroute fx neon "CRUSHING IT"
sleep 1.2
~/.touchroute/bin/touchroute fx confetti
wait
