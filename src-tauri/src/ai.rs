// Asks the Claude Code CLI on this computer to write a slot's script. Claude
// runs with every tool turned off, so it can only answer with text; nothing
// runs until the user reads the script and saves it.

use serde::Serialize;

use crate::actions::login_shell;

#[derive(Serialize)]
pub struct Draft {
    pub name: String,
    pub script: String,
}

pub fn available() -> bool {
    login_shell("command -v claude", None).is_ok_and(|s| !s.trim().is_empty())
}

/// `trigger` finishes the sentence "When the user …", like "holds 3 fingers
/// still on their trackpad for 2 seconds and lets go".
pub fn write_script(request: &str, trigger: &str, current: Option<&str>) -> Result<Draft, String> {
    let revise = match current {
        Some(script) if !script.trim().is_empty() => format!(
            "\nThis is the script they have now. Change it to match the new request:\n```zsh\n{script}\n```\n"
        ),
        _ => String::new(),
    };
    let prompt = format!(
        r#"You write scripts for TouchRoute, a macOS app. When the user {trigger}, TouchRoute runs a zsh script.

They want it to: {request}
{revise}
Rules:
- Write a zsh script for macOS. It runs in the background with `zsh -l script.sh`, with no terminal window attached.
- To show something in a terminal (claude, ssh, a TUI, a dev server), open Terminal through AppleScript exactly like this, passing the command as the argument. It reuses the window Terminal opens when it launches, so the user doesn't get two:
  osascript - "COMMAND" <<'APPLESCRIPT'
  on run argv
    set cmd to item 1 of argv
    set wasRunning to application "Terminal" is running
    tell application "Terminal"
      activate
      if wasRunning then
        do script cmd
      else
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
  The closing APPLESCRIPT line must start at the beginning of the line. Use iTerm's AppleScript instead only if they mention iTerm.
- Never start claude in the home folder: cd into a project first, or into ~/claude (mkdir -p ~/claude). Scanning the home folder makes macOS ask for access to Photos, Music and so on.
- Open apps with `open -a "App Name"` and websites with `open "https://…"`.
- To start several things at once, give each its own Terminal window or background it with &.
- For something fun or celebratory to see, TouchRoute can play full-screen effects: `~/.touchroute/bin/touchroute fx MODE ["caption"]` where MODE is lightning, fire, hearts, warp, matrix, confetti, fireworks, supernova, portal, aurora, neon (the caption is the sign's text), bubbles, galaxy, disco or snow. Emoji effects take the emoji first: `~/.touchroute/bin/touchroute fx MODE "🎉 🎊" ["caption"]` where MODE is pop, spin, rain, burst, float, launch or banner. Each returns right away; add `sleep 2` between effects you want one after another. Pair them with a sound like `afplay /System/Library/Sounds/Glass.aiff &`.
- Never use sudo. Never delete or overwrite files unless they asked for that.
- Keep it short, and add plain-English comments a beginner can follow.

Reply in exactly this format and nothing else:
NAME: <a 2 to 4 word label for this touch>
```zsh
<the script>
```"#
    );

    let reply = login_shell(r#"claude -p --tools "" --output-format text"#, Some(&prompt))
        .map_err(|e| if e.is_empty() { "Claude didn't answer. Try again.".into() } else { e })?;
    parse(&reply).ok_or_else(|| "Claude's answer didn't include a script. Try rewording the request.".into())
}

fn parse(reply: &str) -> Option<Draft> {
    let name = reply
        .lines()
        .find_map(|l| l.trim().strip_prefix("NAME:"))
        .map(|n| n.trim().trim_matches(['"', '*', '`']).to_string())
        .unwrap_or_else(|| "New touch".into());
    let start = reply.find("```")?;
    let body = &reply[start + 3..];
    let body = &body[body.find('\n')? + 1..];
    let end = body.rfind("```")?;
    let mut script = body[..end].trim_end().to_string();
    if !script.starts_with("#!") {
        script = format!("#!/bin/zsh\n{script}");
    }
    Some(Draft { name, script: script + "\n" })
}
