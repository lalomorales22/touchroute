# TouchRoute

Hold fingers on your trackpad, wait, let go, and something runs.

Five fingers held for five seconds opens Terminal and starts Claude. Three fingers for four seconds could start your dev server. Every combination of **fingers × seconds** is a shortcut, and you set each one up by describing what you want.

| | Fingers | Seconds | Touches |
|---|---|---|---|
| macOS | 1 to 10 | 1 to 8 | 80 |
| Windows, Linux *(coming soon)* | 1 to 5 | 1 to 8 | 40 |

9 and 10 seconds are coming soon.

## Install (macOS, Apple silicon)

```bash
curl -fsSL https://raw.githubusercontent.com/lalomorales22/touchroute/main/install.sh | bash
```

This installs TouchRoute into Applications, sets it to start at login (`bash -s -- --no-login` to skip that), and opens it. You can also download `TouchRoute.dmg` from [Releases](https://github.com/lalomorales22/touchroute/releases). The app isn't notarized yet, so the first time you open the DMG version, right-click it and choose Open.

## Using it

- **The buddy.** A small black window of drifting dots sits in the corner of your screen, and each colored dot is one of your touches. Double-click it or scroll up to zoom in, and the dots line up into a list of everything you've set up. Drag it wherever you like.
- **Setting up a touch.** Open Settings from the buddy or the menu bar icon. Pick a square (rows are fingers, columns are seconds), then do one of these:
  - Describe it in plain words and click **Write it with Claude**. This uses the [Claude Code](https://claude.com/claude-code) CLI on your computer, with all of its tools turned off, so it can only write text. You read the script before saving it.
  - Use a quick start: open an app, open a website, run a command in Terminal, or run your own `.sh` file.
  - Write or paste the script yourself.
- **Firing a touch.** Put the fingers down and keep them still. The ring fills one segment per second. Let go on your number. If you move your fingers (a scroll or drag) or hold past 8 seconds, the touch is cancelled.

Color tells you finger count: cyan is one finger, and the colors move through blue and violet to pink and red at ten.

## Files

Everything lives in `~/.touchroute`:

```
config.json        which touches exist and their names
scripts/5-5.sh     the script for 5 fingers, 5 seconds (plain zsh, edit freely)
logs/5-5.log       output from the last run
```

Scripts run in your login shell (`zsh -l`), so your PATH and tools work the same as in Terminal.

## How it works

- **macOS** reads raw touches from the private `MultitouchSupport` framework, the same one BetterTouchTool uses. It needs no permissions and sees every finger.
- A detector turns frames into "N fingers held still for S seconds". It waits for every finger to lift, then runs `~/.touchroute/scripts/N-S.sh`.
- The app is [Tauri 2](https://tauri.app) with a Rust core and a plain HTML/JS interface.

```
src-tauri/src/touch_macos.rs   trackpad reader
src-tauri/src/detector.rs      fingers + stillness + timing → slot
src-tauri/src/actions.rs       runs slot scripts
src-tauri/src/ai.rs            asks the claude CLI to write a script
ui/buddy.*                     the desktop buddy
ui/settings.*                  the grid and editor
site/index.php                 landing page
install.sh                     one-line installer
```

## Build from source

```bash
cargo install tauri-cli --version "^2"
cd src-tauri
cargo tauri dev      # run it
cargo tauri build    # .app and .dmg in target/release/bundle
```

## Roadmap

- Windows: Precision Touchpad through Raw Input
- Linux: evdev multitouch (the user needs to be in the `input` group)
- Intel Mac build, signing and notarization
- 9 and 10 second holds
