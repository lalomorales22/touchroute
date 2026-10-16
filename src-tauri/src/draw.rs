// Drawings: hold Option and draw a shape on the trackpad with one finger. The
// stroke shows up as glowing ink on screen, and when the finger lifts it's
// compared with the user's saved drawings. A close enough match runs that
// drawing's script.
//
// Matching works like the $1 recognizer: both strokes are resampled to the
// same number of evenly spaced points, centered, scaled to the same size and
// compared point by point. Each comparison also tries the stroke drawn
// backwards, slightly rotated, and, for closed shapes like circles, started
// from a different point, so the user doesn't have to draw it exactly the
// same way every time.

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Emitter;

use crate::detector::Touch;
use crate::haptics::{self, Feel};
use crate::{actions, config, fx, APP};

type P = [f32; 2];

const N: usize = 64;
/// How sure a match has to be, from 0 to 1, and how far ahead of the next
/// best drawing, so a lopsided circle doesn't run whichever of "circle" and
/// "heart" scored a hair higher. A shakier stroke still counts when nothing
/// else comes close.
const SURE: f32 = 0.75;
const MARGIN: f32 = 0.05;
const SHAKY: f32 = 0.6;
const SHAKY_MARGIN: f32 = 0.4;
/// Strokes shorter than this (in trackpad heights) are taps, not drawings.
const MIN_LENGTH: f32 = 0.25;

/// While settings is recording a new drawing, strokes go there instead of
/// being matched.
pub static RECORDING: AtomicBool = AtomicBool::new(false);

struct Stroke {
    device: usize,
    points: Vec<P>,
    /// Waiting for every finger to lift after a cancelled stroke.
    cancelled: bool,
}

static STROKE: Mutex<Option<Stroke>> = Mutex::new(None);

#[derive(Serialize, Clone)]
struct Ink {
    phase: &'static str,
    x: f32,
    y: f32,
    name: Option<String>,
}

fn ink(phase: &'static str, x: f32, y: f32, name: Option<String>) {
    if let Some(app) = APP.get() {
        let _ = app.emit_to("fx", "ink", Ink { phase, x, y, name });
    }
}

#[cfg(target_os = "macos")]
mod keys {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceFlagsState(state: i32) -> u64;
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
    }
    const HID: i32 = 1;
    const OPTION: u64 = 0x80000;
    const OTHER_MODIFIERS: u64 = 0x10000 | 0x20000 | 0x40000 | 0x100000; // caps, shift, control, command

    /// Option on its own, with the trackpad not pressed down (so an
    /// Option-drag in Finder isn't taken for a drawing).
    pub fn option_only() -> bool {
        unsafe {
            let flags = CGEventSourceFlagsState(HID);
            flags & OPTION != 0 && flags & OTHER_MODIFIERS == 0 && !CGEventSourceButtonState(HID, 0)
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod keys {
    pub fn option_only() -> bool {
        false
    }
}

/// Called for every trackpad frame before the hold detector. Returns true
/// while a drawing owns the trackpad.
pub fn on_frame(device: usize, touches: &[Touch], aspect: f32) -> bool {
    let mut guard = STROKE.lock().unwrap();
    if let Some(s) = guard.as_mut() {
        if s.device != device {
            return true;
        }
        if s.cancelled {
            if touches.is_empty() {
                *guard = None;
            }
            return true;
        }
        match touches.len() {
            0 => {
                let points = std::mem::take(&mut s.points);
                *guard = None;
                drop(guard);
                finish(points);
            }
            1 => {
                let t = touches[0];
                // Screen-shaped coordinates: x across, y down, in trackpad heights.
                let p = [t.x * aspect, 1.0 - t.y];
                let last = *s.points.last().unwrap();
                if dist(p, last) > 0.004 {
                    s.points.push(p);
                    ink("move", t.x, 1.0 - t.y, None);
                }
            }
            _ => {
                // A second finger means this is a scroll or a gesture after all.
                s.cancelled = true;
                ink("cancel", 0.0, 0.0, None);
            }
        }
        return true;
    }
    if touches.len() != 1 || !(DEMO.load(Ordering::Relaxed) || (config::get().enabled && keys::option_only())) {
        return false;
    }
    let t = touches[0];
    *guard = Some(Stroke { device, points: vec![[t.x * aspect, 1.0 - t.y]], cancelled: false });
    drop(guard);
    fx::follow_cursor();
    ink("start", t.x, 1.0 - t.y, None);
    haptics::feel(Feel::Light);
    true
}

fn finish(points: Vec<P>) {
    if path_length(&points) < MIN_LENGTH {
        ink("cancel", 0.0, 0.0, None);
        return;
    }
    if RECORDING.load(Ordering::Relaxed) {
        haptics::feel(Feel::Medium);
        ink("recorded", 0.0, 0.0, None);
        if let Some(app) = APP.get() {
            let _ = app.emit_to("settings", "draw-sample", &points);
        }
        return;
    }
    let cfg = config::get();
    match recognize(&points, &cfg.drawings) {
        Some((d, _)) => {
            haptics::double(Feel::Strong);
            ink("match", 0.0, 0.0, Some(d.name.clone()));
            actions::run_file(&config::drawing_path(&d.id), &format!("draw-{}", d.id));
            if let Some(app) = APP.get() {
                let _ = app.emit("drew", &d.id);
            }
        }
        None => {
            haptics::feel(Feel::Light);
            ink("miss", 0.0, 0.0, None);
        }
    }
}

/// Debug builds only: TOUCHROUTE_DEMO_DRAW=heart feeds a fake finger stroke
/// through the real pipeline a few seconds after launch, for testing without
/// a hand on the trackpad.
static DEMO: AtomicBool = AtomicBool::new(false);

#[cfg(debug_assertions)]
pub fn demo() {
    let Ok(names) = std::env::var("TOUCHROUTE_DEMO_DRAW") else { return };
    std::thread::spawn(move || {
        for name in names.split(',').cycle().take(names.split(',').count()) {
            std::thread::sleep(std::time::Duration::from_secs(4));
            let pts = shape(name);
            let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
            for p in &pts {
                x0 = x0.min(p[0]);
                y0 = y0.min(p[1]);
                x1 = x1.max(p[0]);
                y1 = y1.max(p[1]);
            }
            DEMO.store(true, Ordering::Relaxed);
            for p in &pts {
                let x = 0.3 + 0.4 * (p[0] - x0) / (x1 - x0).max(1e-6);
                let y = 1.0 - (0.2 + 0.6 * (p[1] - y0) / (y1 - y0).max(1e-6));
                on_frame(1, &[Touch { id: 1, x, y }], 1.5);
                std::thread::sleep(std::time::Duration::from_millis(9));
            }
            on_frame(1, &[], 1.5);
            DEMO.store(false, Ordering::Relaxed);
        }
    });
}

#[cfg(not(debug_assertions))]
pub fn demo() {}

// ---------- recognizer ----------

fn dist(a: P, b: P) -> f32 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn path_length(pts: &[P]) -> f32 {
    pts.windows(2).map(|w| dist(w[0], w[1])).sum()
}

fn resample(pts: &[P]) -> Vec<P> {
    let interval = path_length(pts) / (N - 1) as f32;
    if pts.len() < 2 || interval <= 0.0 {
        return vec![pts.first().copied().unwrap_or([0.0, 0.0]); N];
    }
    let mut out = vec![pts[0]];
    let mut acc = 0.0;
    let mut prev = pts[0];
    let mut i = 1;
    while i < pts.len() {
        let cur = pts[i];
        let d = dist(prev, cur);
        if acc + d >= interval && d > 0.0 {
            let k = (interval - acc) / d;
            let q = [prev[0] + k * (cur[0] - prev[0]), prev[1] + k * (cur[1] - prev[1])];
            out.push(q);
            prev = q;
            acc = 0.0;
        } else {
            acc += d;
            prev = cur;
            i += 1;
        }
    }
    while out.len() < N {
        out.push(*pts.last().unwrap());
    }
    out.truncate(N);
    out
}

/// Evenly spaced, centered on the origin, and scaled to a unit square, so a
/// squashed circle still matches a round one. Flat strokes (a line, a swipe)
/// are scaled evenly instead, so they aren't stretched into a box.
fn normalize(pts: &[P]) -> Vec<P> {
    let mut r = resample(pts);
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for p in &r {
        x0 = x0.min(p[0]);
        y0 = y0.min(p[1]);
        x1 = x1.max(p[0]);
        y1 = y1.max(p[1]);
    }
    let (w, h) = ((x1 - x0).max(1e-6), (y1 - y0).max(1e-6));
    let big = w.max(h);
    let (sx, sy) = if w.min(h) / big > 0.3 { (w, h) } else { (big, big) };
    let cx = r.iter().map(|p| p[0]).sum::<f32>() / N as f32;
    let cy = r.iter().map(|p| p[1]).sum::<f32>() / N as f32;
    for p in &mut r {
        *p = [(p[0] - cx) / sx, (p[1] - cy) / sy];
    }
    r
}

fn closed(pts: &[P]) -> bool {
    dist(pts[0], pts[N - 1]) < 0.25
}

fn rotate(pts: &[P], a: f32) -> Vec<P> {
    let (s, c) = a.sin_cos();
    pts.iter().map(|p| [p[0] * c - p[1] * s, p[0] * s + p[1] * c]).collect()
}

fn avg_distance(a: &[P], b: &[P]) -> f32 {
    a.iter().zip(b).map(|(p, q)| dist(*p, *q)).sum::<f32>() / N as f32
}

fn unit(a: P, b: P) -> P {
    let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
    let l = dx.hypot(dy).max(1e-6);
    [dx / l, dy / l]
}

/// How differently two strokes head along their length, from 0 (always the
/// same direction) to 1 (always opposite). Position alone can't tell a circle
/// from a star whose points sit on that circle; direction can.
fn turn_distance(a: &[P], b: &[P]) -> f32 {
    let mut sum = 0.0;
    for i in 0..N - 2 {
        let (u, v) = (unit(a[i], a[i + 2]), unit(b[i], b[i + 2]));
        sum += (1.0 - (u[0] * v[0] + u[1] * v[1])) / 2.0;
    }
    sum / (N - 2) as f32
}

/// The two ways strokes differ, for the closest alignment: (position, direction).
fn distances(cand: &[P], tmpl: &[P]) -> (f32, f32) {
    let mut variants: Vec<Vec<P>> = vec![cand.to_vec(), cand.iter().rev().copied().collect()];
    if closed(cand) && closed(tmpl) {
        let base = variants.clone();
        for v in &base {
            for shift in (4..N).step_by(4) {
                let mut s = v.clone();
                s.rotate_left(shift);
                variants.push(s);
            }
        }
    }
    let mut best = (f32::MAX, f32::MAX, f32::MAX);
    for v in &variants {
        for step in -2..=2 {
            let r = rotate(v, step as f32 * PI / 18.0);
            let (pos, dir) = (avg_distance(&r, tmpl), turn_distance(&r, tmpl));
            let total = pos / POS_SCALE + dir / DIR_SCALE;
            if total < best.0 {
                best = (total, pos, dir);
            }
        }
    }
    (best.1, best.2)
}

const POS_SCALE: f32 = 0.35;
const DIR_SCALE: f32 = 0.35;

/// How alike two normalized strokes are, from 0 (nothing alike) to 1 (same).
fn similarity(cand: &[P], tmpl: &[P]) -> f32 {
    let (pos, dir) = distances(cand, tmpl);
    (1.0 - (pos / POS_SCALE + dir / DIR_SCALE) / 2.0).max(0.0)
}

/// The saved drawing that best matches this stroke, if one clearly does.
pub fn recognize<'a>(stroke: &[P], drawings: &'a [config::Drawing]) -> Option<(&'a config::Drawing, f32)> {
    let cand = normalize(stroke);
    let mut scored: Vec<(&config::Drawing, f32)> = drawings
        .iter()
        .map(|d| {
            let score = d
                .samples
                .iter()
                .filter(|s| s.len() >= 2)
                .map(|s| similarity(&cand, &normalize(s)))
                .fold(0.0, f32::max);
            (d, score)
        })
        .collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    let best = *scored.first()?;
    let runner_up = scored.get(1).map_or(0.0, |s| s.1);
    let lead = best.1 - runner_up;
    let ok = (best.1 >= SURE && lead >= MARGIN) || (best.1 >= SHAKY && lead >= SHAKY_MARGIN);
    ok.then_some(best)
}

// ---------- starter shapes ----------

/// The shapes the drawing pack starts with, drawn the way most people would.
pub fn shape(name: &str) -> Vec<P> {
    let n = 80;
    let t = |i: usize| i as f32 / (n - 1) as f32;
    let pts: Vec<P> = match name {
        // Counterclockwise from the top, like writing an "o".
        "circle" => (0..n).map(|i| {
            let a = -PI / 2.0 - t(i) * 2.0 * PI;
            [a.cos(), a.sin()]
        }).collect(),
        // From the dip at the top, down the left lobe to the point, up the right.
        "heart" => (0..n).map(|i| {
            let a = t(i) * 2.0 * PI;
            let x = 16.0 * a.sin().powi(3);
            let y = 13.0 * a.cos() - 5.0 * (2.0 * a).cos() - 2.0 * (3.0 * a).cos() - (4.0 * a).cos();
            [-x, -y]
        }).collect(),
        "check" => polyline(&[[0.0, 0.55], [0.35, 1.0], [1.0, 0.0]]),
        "lightning" => polyline(&[[0.65, 0.0], [0.2, 0.55], [0.75, 0.45], [0.3, 1.0]]),
        // A five-pointed star in one stroke: bottom left, top, bottom right,
        // left, right, back to the bottom left. Each corner is 144° on.
        "star" => {
            let p = |k: usize| {
                let a = -PI / 2.0 + k as f32 * 4.0 * PI / 5.0;
                [a.cos(), a.sin()]
            };
            polyline(&[p(4), p(0), p(1), p(2), p(3), p(4)])
        }
        // Two and a half turns outward from the middle.
        "spiral" => (0..n).map(|i| {
            let k = t(i);
            let a = k * 5.0 * PI;
            [a.cos() * (0.1 + k), a.sin() * (0.1 + k)]
        }).collect(),
        "triangle" => polyline(&[[0.5, 0.0], [0.0, 0.9], [1.0, 0.9], [0.5, 0.0]]),
        // Z, like the letter: across, diagonal back, across.
        "zigzag" => polyline(&[[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]),
        _ => Vec::new(),
    };
    pts.into_iter().map(|[x, y]| [(x * 1000.0).round() / 1000.0, (y * 1000.0).round() / 1000.0]).collect()
}

fn polyline(corners: &[P]) -> Vec<P> {
    let mut out = Vec::new();
    for w in corners.windows(2) {
        for i in 0..20 {
            let k = i as f32 / 20.0;
            out.push([w[0][0] + (w[1][0] - w[0][0]) * k, w[0][1] + (w[1][1] - w[0][1]) * k]);
        }
    }
    out.push(*corners.last().unwrap());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHAPES: [&str; 8] = ["circle", "heart", "check", "lightning", "star", "spiral", "triangle", "zigzag"];

    fn drawings() -> Vec<config::Drawing> {
        SHAPES
            .iter()
            .map(|s| config::Drawing { id: s.to_string(), name: s.to_string(), prompt: String::new(), samples: vec![shape(s)] })
            .collect()
    }

    /// A shaky, squashed, rotated, reversed copy, like a real finger would draw.
    pub fn wobble(pts: &[P], seed: u32, reverse: bool) -> Vec<P> {
        let mut r = seed.wrapping_mul(2654435761);
        let mut rnd = || {
            r ^= r << 13;
            r ^= r >> 17;
            r ^= r << 5;
            (r % 1000) as f32 / 1000.0 - 0.5
        };
        let a = rnd() * 0.3;
        let sx = 0.6 + rnd() * 0.2;
        let mut out: Vec<P> = rotate(pts, a).iter().map(|p| [p[0] * sx * 1.2 + 3.0, p[1] * 0.6 + 2.0]).collect();
        // Hands drift smoothly rather than jitter point to point.
        let (f1, f2, ph1, ph2) = (2.0 + rnd() * 3.0, 2.0 + rnd() * 3.0, rnd() * 6.0, rnd() * 6.0);
        let n = out.len() as f32;
        for (i, p) in out.iter_mut().enumerate() {
            let k = i as f32 / n;
            p[0] += (k * f1 * 6.28 + ph1).sin() * 0.04;
            p[1] += (k * f2 * 6.28 + ph2).sin() * 0.04;
        }
        if reverse {
            out.reverse();
        }
        out
    }

    #[test]
    fn each_shape_matches_itself_when_drawn_messily() {
        let ds = drawings();
        for (i, s) in SHAPES.iter().enumerate() {
            for seed in 1..8 {
                let stroke = wobble(&shape(s), seed + i as u32 * 10, seed % 2 == 0);
                let got = recognize(&stroke, &ds).map(|(d, sc)| (d.id.clone(), sc));
                assert_eq!(got.as_ref().map(|g| g.0.as_str()), Some(*s), "{s} seed {seed}: {got:?}");
            }
        }
    }

    #[test]
    fn every_starter_drawing_has_a_shape() {
        for (id, _, _, shape_name, _) in crate::starter::DRAWINGS {
            assert!(shape(shape_name).len() > 10, "{id} uses unknown shape {shape_name}");
        }
    }

    #[test]
    fn a_circle_started_anywhere_is_a_circle() {
        let ds = drawings();
        let mut c = shape("circle");
        c.rotate_left(30);
        assert_eq!(recognize(&c, &ds).unwrap().0.id, "circle");
    }

    #[test]
    fn a_straight_line_matches_nothing() {
        let ds = drawings();
        let line: Vec<P> = (0..40).map(|i| [i as f32 / 40.0, 0.3]).collect();
        assert!(recognize(&line, &ds).is_none(), "{:?}", recognize(&line, &ds).map(|x| (&x.0.id, x.1)));
    }

    #[test]
    fn shapes_dont_trigger_each_other() {
        for a in SHAPES {
            let others: Vec<_> = drawings().into_iter().filter(|d| d.id != a).collect();
            let got = recognize(&shape(a), &others).map(|(d, s)| (d.id.clone(), s));
            assert!(got.is_none(), "{a} ran {got:?}");
        }
    }
}
