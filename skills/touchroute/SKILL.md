---
name: touchroute
description: Set up, change, list, or remove TouchRoute trackpad touches. TouchRoute runs a script when the user holds N fingers still on their trackpad for S seconds and lets go. Use whenever the user mentions TouchRoute, "touches", finger shortcuts, "five fingers five seconds", a code like 5·5 or 3-4, or asks to make their trackpad open an app, run a script, start Claude or agents, or do anything when they hold fingers down.
---

# TouchRoute

TouchRoute is a desktop app that turns the trackpad into shortcuts. The user holds **N fingers** still for **S seconds**, lets go, and TouchRoute runs that slot's script. Each combination is one **touch**, written `N·S` (like `5·5`) in the app and `N-S` (like `5-5`) in files.

| Platform | Fingers | Seconds |
|---|---|---|
| macOS | 1 to 10 | 1 to 8 |
| Windows, Linux | 1 to 5 | 1 to 8 |

Everything you need is in plain files. The app watches them and picks up changes within about two seconds, so you never need to restart it.

## Files

```
~/.touchroute/
  config.json        the list of touches and their names
  scripts/N-S.sh     the script each touch runs
  logs/N-S.log       output from the last time that touch ran
```

`config.json`:

```json
{
  "enabled": true,
  "slots": {
    "5-5": { "name": "Talk to Claude", "prompt": "Open Terminal and start claude" }
  },
  "buddy_position": [1437.0, 168.0]
}
```

- `slots` keys are `"N-S"`. `name` is the label the user sees on their desktop buddy, so keep it to 2 to 4 words. `prompt` is the plain-English request the touch came from (optional, but fill it in so the user can revise it later).
- `enabled: false` pauses every touch. Don't change it unless asked.
- `theme` sets the orb colors: `classic`, `dusk` (darker), `neon` (brighter) or `cosmic` (galaxy-filled orbs). Change it only when the user asks.
- Leave `buddy_position` and any other fields alone.

A touch only exists when it has **both** an entry in `slots` and a script at `scripts/N-S.sh`.

## Adding or changing a touch

1. **Pick the slot.** Use the one the user named. If they didn't name one, suggest a free slot that's easy to remember (5·5 for their most important action, more fingers or seconds for rarer ones) and confirm it with them. Avoid 1-finger touches: a resting finger can set them off by accident. On Windows and Linux, never pick more than 5 fingers.
2. **Check what's there.** Read `config.json`. If the slot is taken, tell the user what it does now and ask before replacing it.
3. **Write the script** to `~/.touchroute/scripts/N-S.sh` and make it executable (`chmod +x`). See the rules below.
4. **Add the slot** to `config.json`. Read, modify and write back the whole file. Keep it valid JSON and keep the other slots as they are.
5. **Test it** if it's safe to run right now: `zsh -l ~/.touchroute/scripts/N-S.sh` (on Linux, `bash -l`). Then check `~/.touchroute/logs/` or the command's output for errors.
6. **Tell the user** how to fire it: "Hold N fingers still for S seconds, then let go." Mention that the dot for it now shows on their buddy.

To **remove** a touch, delete its entry from `slots` and delete its script file.

To **list** touches, read `config.json` and present them sorted by fingers, then seconds, for example `5·5  Talk to Claude`.

## Script rules

Scripts run in the background in a login shell (`zsh -l` on macOS), from the home directory, with no terminal window attached. The user's PATH works the same as in their terminal.

- Start with `#!/bin/zsh` (macOS) or `#!/bin/bash` (Linux), followed by a one-line comment saying what the touch does.
- Add short, plain-English comments. The user may not be a programmer.
- **To show something in a terminal** (claude, ssh, a TUI, a dev server), open a Terminal window and run the command there:

  ```zsh
  osascript - "cd ~/code/site && npm run dev" <<'APPLESCRIPT'
  on run argv
    set cmd to item 1 of argv
    set wasRunning to application "Terminal" is running
    tell application "Terminal"
      activate
      if wasRunning then
        do script cmd
      else
        -- Terminal opens its own window when it launches. Reuse it,
        -- or the user ends up with two windows.
        repeat 50 times
          if (count of windows) > 0 then exit repeat
          delay 0.1
        end repeat
        if (count of windows) > 0 then
          do script cmd in window 1
        else
          do script cmd
        end if
      end if
    end tell
  end run
  APPLESCRIPT
  ```

  Always use this pattern. A bare `activate` + `do script` opens **two** windows when Terminal wasn't already running (Terminal's own startup window, plus the one `do script` makes). The command is passed as an argument, so it needs no escaping. Use iTerm's AppleScript only if the user uses iTerm.
- **Never start `claude` (or any tool that scans its folder) in the home folder.** A new Terminal window opens in `~`, and scanning it makes macOS ask for access to Photos, Music, Google Drive and so on. Always `cd` first: into the project the user named, or `~/claude` (create it with `mkdir -p ~/claude` if missing) as a neutral default.
- **Apps:** `open -a "Spotify"`. **Websites:** `open "https://example.com"`. **Files and folders:** `open ~/Documents/plan.md`.
- **Several agents or tasks at once:** give each its own Terminal window (one `do script` per window), or background quick commands with `&`.
- **Emoji effects:** TouchRoute ships `~/.touchroute/fun/fx.js`, which animates emoji over the screen for a few seconds (clicks pass through). `osascript -l JavaScript ~/.touchroute/fun/fx.js MODE "🎉 🎊 ✨" ["caption"]`, where MODE is `pop`, `spin`, `rain`, `burst`, `fireworks`, `float`, `launch` or `banner` (banner needs the text). Pair it with a sound: `afplay /System/Library/Sounds/Glass.aiff &`.
- **Notifications:** `osascript -e 'display notification "Deployed" with title "TouchRoute"'`.
- Never use `sudo`. Never delete, overwrite or move the user's files unless they explicitly asked for that touch to do it.
- Never put passwords, tokens or keys in a script. If the touch needs one, read it from where the user already keeps it (an environment variable, the keychain via `security find-generic-password`, or a CLI that's already logged in).
- If the user already has a script, a touch can just run it: `zsh "$HOME/bin/deploy.sh"`.

## Examples

**"Make 5 fingers for 5 seconds open Claude"** → `5-5`, name `Talk to Claude`:

```zsh
#!/bin/zsh
# Open a Terminal window and start Claude Code in ~/claude.
mkdir -p ~/claude
osascript - "cd ~/claude && claude" <<'APPLESCRIPT'
on run argv
  set cmd to item 1 of argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if wasRunning then
      do script cmd
    else
      -- Terminal opens its own window when it launches. Reuse it,
      -- or the user ends up with two windows.
      repeat 50 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      if (count of windows) > 0 then
        do script cmd in window 1
      else
        do script cmd
      end if
    end if
  end tell
end run
APPLESCRIPT
```

**"Four fingers, seven seconds: start agents on my three projects"** → `4-7`, name `Launch 3 agents`:

```zsh
#!/bin/zsh
# Open one Terminal window per project, each running Claude Code.
for project in ~/code/site ~/code/api ~/code/app; do
  osascript - "cd ${(q)project} && claude" <<'APPLESCRIPT'
on run argv
  set cmd to item 1 of argv
  set wasRunning to application "Terminal" is running
  tell application "Terminal"
    activate
    if wasRunning then
      do script cmd
    else
      -- Terminal opens its own window when it launches. Reuse it,
      -- or the user ends up with two windows.
      repeat 50 times
        if (count of windows) > 0 then exit repeat
        delay 0.1
      end repeat
      if (count of windows) > 0 then
        do script cmd in window 1
      else
        do script cmd
      end if
    end if
  end tell
end run
APPLESCRIPT
done
```

**"Two fingers two seconds plays Spotify"** → `2-2`, name `Play Spotify`:

```zsh
#!/bin/zsh
# Open Spotify and start playing.
open -a "Spotify"
sleep 2
osascript -e 'tell application "Spotify" to play'
```

## If something doesn't work

- **Nothing happens when the user holds fingers:** check `"enabled": true` in `config.json`, and that the TouchRoute app is running (on macOS, `pgrep -x touchroute`). The fingers must stay still: moving them counts as a scroll and cancels the touch.
- **The touch fires but does nothing:** read `~/.touchroute/logs/N-S.log`. The first time a script controls Terminal or another app, macOS asks the user to allow it. Tell them to click Allow.
- **The wrong touch fires:** the user may be lifting late or early. The seconds count from when the fingers land, and the desktop buddy shows the live count, so suggest they watch it.
- **The trackpad isn't detected** (for example, one plugged in after launch): TouchRoute looks for trackpads again every minute and after the Mac wakes, so wait a minute. If it still isn't seen, quit TouchRoute from the menu bar and open it again.
