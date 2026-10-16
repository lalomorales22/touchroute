#!/bin/zsh
# Fireworks, then a rain of celebration.
afplay /System/Library/Sounds/Hero.aiff &
osascript -l JavaScript ~/.touchroute/fun/fx.js fireworks "🎆 🎇 ✨ 💥"
osascript -l JavaScript ~/.touchroute/fun/fx.js rain "🎉 🎊 🥳 🏆"
wait
