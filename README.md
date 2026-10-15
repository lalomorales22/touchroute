<p align="center">
  <img src="assets/media/banner.png" alt="TouchRoute: hold your fingers down, let go, it runs" width="100%">
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20silicon-d6d9de?style=flat-square&labelColor=000000">
  <img alt="Windows and Linux coming soon" src="https://img.shields.io/badge/Windows%20%2B%20Linux-coming%20soon-55585e?style=flat-square&labelColor=000000">
  <img alt="Built with Tauri 2" src="https://img.shields.io/badge/Tauri-2-a9b7c4?style=flat-square&labelColor=000000">
  <img alt="Comes with a Claude Code skill" src="https://img.shields.io/badge/Claude%20Code-skill%20included-c9bfa7?style=flat-square&labelColor=000000">
</p>

<p align="center">
  <b>Your trackpad is a keyboard made of hands.</b><br>
  Put five fingers down. Count to five. Let go. Terminal opens and you're talking to Claude.
</p>

---

## Hold. Count. Let go.

<table>
<tr>
<td width="46%"><img src="assets/media/hold.gif" alt="Five fingers held on the trackpad: a ring fills one segment per second, reaches 5·5, and fires Talk to Claude" width="100%"></td>
<td>

Every combination of **fingers × seconds** is its own shortcut.

Put the fingers down and keep them still. A ring fills one segment per second, showing which touch you're on and what it does. Lift on your number, and it runs.

Move your fingers and it cancels, so scrolling, clicking and dragging never set anything off.

| | Fingers | Seconds | Touches |
|---|:-:|:-:|:-:|
| **macOS** | 1–10 | 1–8 | **80** |
| Windows, Linux *(soon)* | 1–5 | 1–8 | 40 |

</td>
</tr>
</table>

## A buddy that lives on your desktop

<table>
<tr>
<td>

TouchRoute doesn't sit in a window. It's a little swarm of dots floating on your desktop: they drift, breathe, hop, and lean toward your cursor. **Each colored dot is one of your touches.**

Scroll up on it (or double-click) and the dots slowly unfold into a **dial**: rings are fingers, spokes are seconds, and every touch sits in its spot. Point at a dot to see what it does. Click any spot to set it up. Scroll down and they drift back home.

No more forgetting what `4·7` does.

</td>
<td width="52%"><img src="assets/media/dial.gif" alt="The buddy's dots unfold into a circular dial of fingers and seconds; pointing at dots shows Talk to Claude and Start dev server" width="100%"></td>
</tr>
</table>

## Set it up by saying what you want

<img src="assets/media/settings.png" alt="TouchRoute settings: a grid of fingers by seconds, with the 4·7 Launch 3 agents touch open and its script shown" width="100%">

Pick a square, describe it in plain words, and click **Write it with Claude**. The [Claude Code](https://claude.com/claude-code) CLI on your computer writes the script. It runs with every tool turned off, so it can only write text, and you read the script before anything is saved.

Not into AI? Use a quick start (open an app, open a website, run a command in Terminal, run your own `.sh`) or write the script yourself.

### …or just ask your AI

TouchRoute comes with a **[skill](skills/touchroute/SKILL.md)** that teaches AI agents how it works. The installer adds it to Claude Code, so you can ask for touches without opening settings:

> **you:** make four fingers for seven seconds open claude in my three projects
>
> **claude:** Done. `4·7 Launch 3 agents` opens a Terminal window in `~/code/site`, `~/code/api` and `~/code/app`, each running `claude`. Hold 4 fingers still for 7 seconds and let go.

The app picks up changes within a couple of seconds, and the new dot shows up on your buddy. Other agents can use the skill too: point them at [`skills/touchroute/SKILL.md`](skills/touchroute/SKILL.md).

## Install

**macOS (Apple silicon):**

```bash
curl -fsSL https://raw.githubusercontent.com/lalomorales22/touchroute/main/install.sh | bash
```

The installer:

- puts TouchRoute in Applications
- starts it at login (skip with `bash -s -- --no-login`)
- adds the Claude Code skill (skip with `--no-skill`)
- opens the app

Then hold **five fingers for five seconds**. That touch comes set up to open Claude.

Prefer a download? Grab `TouchRoute.dmg` from [Releases](https://github.com/lalomorales22/touchroute/releases). The app isn't notarized yet, so the first time you open it, right-click it and choose **Open**.

**Windows and Linux:** coming soon, with up to 5 fingers.

## The fun pack

A fresh install comes with the grid already full of things to try: confetti, fireworks, money rain, floating hearts, a magic 8 ball, dice, a coin flip, dad jokes, and quick ways to open the apps every Mac has. The emoji effects draw over your screen for a few seconds, and clicks pass straight through.

Don't want them? **Clear all** under the grid empties it, and **Add fun pack** brings them back without touching your own touches.

## Ideas

| Touch | What it does |
|:-:|---|
| `5·5` | Open Terminal and start Claude |
| `4·7` | Open Claude in three project folders at once |
| `3·4` | Start the dev server and open `localhost:3000` |
| `2·2` | Play Spotify |
| `3·1` | Lock the screen |
| `6·3` | Run your deploy script and notify you when it's done |
| `7·8` | Morning routine: mail, calendar, standup notes, music |

## Under the hood

Everything lives in plain files you can edit, back up or sync:

```
~/.touchroute/
  config.json        your touches and their names
  scripts/5-5.sh     what 5 fingers × 5 seconds runs (plain zsh)
  logs/5-5.log       output from the last run
  fun/fx.js          the emoji effects the fun pack uses
```

- **Trackpad:** on macOS, TouchRoute reads raw contacts from the private `MultitouchSupport` framework (the one BetterTouchTool uses). It needs no permissions and sees all ten fingers.
- **Detection:** waits ~0.3 s for the finger count to settle, times from the moment the fingers land, ignores a finger that blinks out for a split second, and cancels if anything moves.
- **Scripts:** run in your login shell, so your PATH, tools and aliases work the same as in Terminal.
- **Updates:** when a new release is out, an **Update** button shows up in settings. It downloads the release, swaps the app and reopens it.
- **App:** [Tauri 2](https://tauri.app), a Rust core with a plain HTML/JS interface. About 6 MB.

```
src-tauri/src/touch_macos.rs   trackpad reader
src-tauri/src/detector.rs      fingers + stillness + timing → touch
src-tauri/src/actions.rs       runs touch scripts
src-tauri/src/ai.rs            asks the claude CLI to write a script
src-tauri/src/update.rs        checks GitHub for a new release and installs it
src-tauri/starter/             the fun pack's scripts and emoji effects
ui/buddy.*                     the floating buddy and its dial
ui/settings.*                  the grid and editor
skills/touchroute/SKILL.md     teaches AI agents to set up touches
site/index.php                 landing page
install.sh                     one-line installer
```

### Build from source

```bash
cargo install tauri-cli --version "^2"
cd src-tauri
cargo tauri dev      # run it
cargo tauri build    # .app and .dmg in target/release/bundle
```

To see exactly what the trackpad reports, run `TOUCHROUTE_DEBUG=1 cargo tauri dev`. It prints every change in contacts and finger states.

## Roadmap

- [ ] Windows: Precision Touchpad through Raw Input
- [ ] Linux: multitouch through evdev
- [ ] Intel Macs, signing and notarization
- [ ] 9 and 10 second holds
- [ ] Touch chains: one touch that runs several in sequence
