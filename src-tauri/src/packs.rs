// Touch packs: a set of touches and drawings in one .touchroute file (plain
// JSON) that anyone can share. Export writes your own; installing one adds its
// touches to empty squares, or replaces yours if you say so.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::config::{self, Drawing, Slot};

const MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
pub struct Pack {
    /// Format version; always 1 for now.
    pub touchroute_pack: u32,
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub touches: Vec<PackTouch>,
    #[serde(default)]
    pub drawings: Vec<PackDrawing>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PackTouch {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub prompt: String,
    pub script: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct PackDrawing {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub prompt: String,
    pub samples: Vec<Vec<[f32; 2]>>,
    pub script: String,
}

#[derive(Serialize)]
pub struct Installed {
    pub added: usize,
    pub replaced: usize,
    pub skipped: usize,
}

fn check(pack: Pack) -> Result<Pack, String> {
    if pack.touchroute_pack != 1 {
        return Err("This pack was made by a newer TouchRoute. Update to open it.".into());
    }
    if let Some(t) = pack.touches.iter().find(|t| !config::valid_key(&t.key)) {
        return Err(format!("This pack has a touch at \"{}\", which isn't a real square.", t.key));
    }
    if let Some(d) = pack.drawings.iter().find(|d| !config::valid_id(&d.id)) {
        return Err(format!("This pack has a drawing with a bad id, \"{}\".", d.id));
    }
    if pack.touches.is_empty() && pack.drawings.is_empty() {
        return Err("This pack is empty.".into());
    }
    Ok(pack)
}

pub fn parse(bytes: &[u8]) -> Result<Pack, String> {
    if bytes.len() > MAX_BYTES {
        return Err("That file is too big to be a TouchRoute pack.".into());
    }
    let pack: Pack = serde_json::from_slice(bytes).map_err(|_| "That isn't a TouchRoute pack.".to_string())?;
    check(pack)
}

pub fn read(path: &Path) -> Result<Pack, String> {
    let bytes = fs::read(path).map_err(|e| format!("Couldn't open {}: {e}", path.display()))?;
    parse(&bytes)
}

/// Downloads a pack from a web address (a raw GitHub file, a gist, anything
/// that serves the JSON).
pub fn fetch(url: &str) -> Result<Pack, String> {
    let url = url.trim();
    if !url.starts_with("https://") {
        return Err("Use a link that starts with https://".into());
    }
    // A GitHub page link works too: point it at the raw file.
    let url = if url.starts_with("https://github.com/") && url.contains("/blob/") {
        url.replacen("https://github.com/", "https://raw.githubusercontent.com/", 1).replacen("/blob/", "/", 1)
    } else if url.starts_with("https://gist.github.com/") && !url.ends_with("/raw") {
        format!("{url}/raw")
    } else {
        url.to_string()
    };
    let out = Command::new("/usr/bin/curl")
        .args(["-fsSL", "--max-time", "20", "--max-filesize", &MAX_BYTES.to_string()])
        .arg(&url)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err("Couldn't download that pack. Check the link.".into());
    }
    parse(&out.stdout)
}

/// Asks for a .touchroute file with the standard macOS file picker.
pub fn choose_file() -> Option<PathBuf> {
    let out = Command::new("/usr/bin/osascript")
        .args([
            "-e",
            r#"POSIX path of (choose file with prompt "Choose a TouchRoute pack" of type {"touchroute", "json", "public.json", "public.data"})"#,
        ])
        .output()
        .ok()?;
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (out.status.success() && !path.is_empty()).then(|| PathBuf::from(path))
}

/// Everything the user has set up, as a pack.
pub fn mine(name: &str, author: &str) -> Pack {
    let cfg = config::get();
    let touches = cfg
        .slots
        .iter()
        .filter_map(|(key, slot)| {
            let script = fs::read_to_string(config::script_path(key)).ok()?;
            Some(PackTouch { key: key.clone(), name: slot.name.clone(), prompt: slot.prompt.clone(), script })
        })
        .collect();
    let drawings = cfg
        .drawings
        .iter()
        .filter_map(|d| {
            let script = fs::read_to_string(config::drawing_path(&d.id)).ok()?;
            Some(PackDrawing { id: d.id.clone(), name: d.name.clone(), prompt: d.prompt.clone(), samples: d.samples.clone(), script })
        })
        .collect();
    Pack { touchroute_pack: 1, name: name.into(), author: author.into(), description: String::new(), touches, drawings }
}

/// Saves a pack to the Desktop and shows it in Finder.
pub fn export(pack: &Pack) -> Result<PathBuf, String> {
    let home = PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| ".".into()));
    let base: String = pack.name.chars().filter(|c| c.is_alphanumeric() || " -_".contains(*c)).collect();
    let base = if base.trim().is_empty() { "My touches".to_string() } else { base.trim().to_string() };
    let mut path = home.join("Desktop").join(format!("{base}.touchroute"));
    let mut n = 2;
    while path.exists() {
        path = home.join("Desktop").join(format!("{base} {n}.touchroute"));
        n += 1;
    }
    let json = serde_json::to_string_pretty(pack).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| format!("Couldn't save to your Desktop: {e}"))?;
    let _ = Command::new("open").arg("-R").arg(&path).spawn();
    Ok(path)
}

/// Adds a pack. Without `replace`, squares and drawings you already have are
/// left alone.
pub fn install(pack: &Pack, replace: bool) -> Result<Installed, String> {
    let pack = check(pack.clone())?;
    let mut r = Installed { added: 0, replaced: 0, skipped: 0 };
    config::update(|c| {
        for t in &pack.touches {
            let taken = c.slots.contains_key(&t.key);
            if taken && !replace {
                r.skipped += 1;
                continue;
            }
            if config::write_script(&t.key, &t.script).is_err() {
                r.skipped += 1;
                continue;
            }
            c.slots.insert(t.key.clone(), Slot { name: t.name.clone(), prompt: t.prompt.clone() });
            if taken { r.replaced += 1 } else { r.added += 1 }
        }
        for d in &pack.drawings {
            let at = c.drawings.iter().position(|x| x.id == d.id || x.name.eq_ignore_ascii_case(&d.name));
            if at.is_some() && !replace {
                r.skipped += 1;
                continue;
            }
            // A drawing that replaces one with a different id keeps the old id.
            let id = at.map_or(d.id.clone(), |i| c.drawings[i].id.clone());
            if config::write_drawing(&id, &d.script).is_err() {
                r.skipped += 1;
                continue;
            }
            let new = Drawing { id, name: d.name.clone(), prompt: d.prompt.clone(), samples: d.samples.clone() };
            match at {
                Some(i) => {
                    c.drawings[i] = new;
                    r.replaced += 1;
                }
                None => {
                    c.drawings.push(new);
                    r.added += 1;
                }
            }
        }
    });
    Ok(r)
}

/// The packs that come with the app.
pub fn builtin(name: &str) -> Option<Pack> {
    use crate::starter;
    match name {
        "fun" => Some(Pack {
            touchroute_pack: 1,
            name: "Fun pack".into(),
            author: "TouchRoute".into(),
            description: "Lightning, fireworks, warp speed, the Matrix, a magic 8 ball and more.".into(),
            touches: starter::SLOTS
                .iter()
                .map(|(k, n, p, s)| PackTouch { key: k.to_string(), name: n.to_string(), prompt: p.to_string(), script: s.to_string() })
                .collect(),
            drawings: Vec::new(),
        }),
        "drawings" => Some(Pack {
            touchroute_pack: 1,
            name: "Drawing pack".into(),
            author: "TouchRoute".into(),
            description: "Draw a heart, a circle, a star, a check mark, a lightning bolt, a spiral or a triangle.".into(),
            touches: Vec::new(),
            drawings: starter::DRAWINGS
                .iter()
                .map(|(id, n, p, shape, s)| PackDrawing {
                    id: id.to_string(),
                    name: n.to_string(),
                    prompt: p.to_string(),
                    samples: vec![crate::draw::shape(shape)],
                    script: s.to_string(),
                })
                .collect(),
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_packs_survive_a_round_trip() {
        for name in ["fun", "drawings"] {
            let pack = builtin(name).unwrap();
            let json = serde_json::to_vec_pretty(&pack).unwrap();
            let back = parse(&json).unwrap();
            assert_eq!(back.touches.len(), pack.touches.len());
            assert_eq!(back.drawings.len(), pack.drawings.len());
        }
    }

    #[test]
    fn bad_packs_are_refused() {
        let escape = r#"{"touchroute_pack":1,"name":"x","touches":[{"key":"../../evil","name":"x","script":"rm -rf ~"}]}"#;
        assert!(parse(escape.as_bytes()).is_err());
        let bad_id = r#"{"touchroute_pack":1,"name":"x","drawings":[{"id":"../x","name":"x","samples":[],"script":""}]}"#;
        assert!(parse(bad_id.as_bytes()).is_err());
        assert!(parse(br#"{"touchroute_pack":2,"name":"x","touches":[{"key":"1-1","name":"x","script":""}]}"#).is_err());
        assert!(parse(b"not json").is_err());
        assert!(parse(br#"{"touchroute_pack":1,"name":"empty"}"#).is_err());
    }
}
