// Lets scripts talk to the running app through a socket in ~/.touchroute.
// The `touchroute` command in ~/.touchroute/bin is a tiny wrapper around it:
//
//   touchroute fx MODE [TEXT]              play a full-screen effect
//   touchroute fx MODE "EMOJI …" [TEXT]    emoji effects
//   touchroute feel [light|medium|strong]  click the trackpad
//
// Each request is one line of tab-separated words; the reply is one line.

use std::io::{BufRead, BufReader, Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::time::Duration;

use crate::haptics::{self, Feel};
use crate::{config, fx};

const CLI: &str = r#"#!/bin/zsh
# touchroute: talk to the running TouchRoute app. TouchRoute rewrites this file
# every time it starts.
#
#   touchroute fx MODE [TEXT]               a full-screen effect, with an optional caption
#   touchroute fx MODE "EMOJI EMOJI" [TEXT] emoji effects
#   touchroute feel [light|medium|strong]   click the trackpad
#
# Effects: lightning fire hearts warp matrix confetti fireworks supernova
#          portal aurora neon bubbles galaxy disco snow
# Emoji effects: pop spin rain burst float launch banner
sock="$HOME/.touchroute/touchroute.sock"
if [[ ! -S $sock ]]; then
  print -u2 "TouchRoute isn't running."
  exit 1
fi
reply=$(print -rn -- "${(pj:\t:)@}"$'\n' | /usr/bin/nc -U "$sock" 2>/dev/null)
if [[ $reply != ok* ]]; then
  print -u2 -- "${reply:-TouchRoute didn't answer.}"
  exit 1
fi
"#;

pub fn socket_path() -> std::path::PathBuf {
    config::home().join("touchroute.sock")
}

pub fn install_cli() {
    let dir = config::home().join("bin");
    let _ = std::fs::create_dir_all(&dir);
    let _ = config::write_exec(&dir.join("touchroute"), CLI);
}

pub fn serve() {
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("touchroute: couldn't open {}: {e}", path.display());
            return;
        }
    };
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            std::thread::spawn(move || handle(conn));
        }
    });
}

fn handle(mut conn: UnixStream) {
    let _ = conn.set_read_timeout(Some(Duration::from_secs(2)));
    let mut line = String::new();
    if BufReader::new((&conn).take(64 * 1024)).read_line(&mut line).is_err() {
        return;
    }
    let words: Vec<&str> = line.trim_end_matches(['\n', '\r']).split('\t').collect();
    let reply = match words.as_slice() {
        ["fx", mode, args @ ..] => fx::play(mode, args).map(|_| "ok".to_string()),
        ["feel", rest @ ..] => {
            let kind = match rest.first().copied() {
                Some("light") => Feel::Light,
                Some("strong") => Feel::Strong,
                _ => Feel::Medium,
            };
            haptics::feel(kind);
            Ok("ok".into())
        }
        ["ping"] => Ok("ok".into()),
        _ => Err("Usage: touchroute fx MODE [TEXT] | touchroute feel [light|medium|strong]".into()),
    };
    let _ = writeln!(conn, "{}", reply.unwrap_or_else(|e| e));
}
