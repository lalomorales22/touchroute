// Clicks you can feel through a Force Touch trackpad: a light tap for each
// second you hold, a firmer one on a square that has a touch, and a strong
// click when something fires.

#[derive(Clone, Copy)]
pub enum Feel {
    Light,
    Medium,
    Strong,
}

pub fn feel(kind: Feel) {
    if !crate::config::get().haptics {
        return;
    }
    #[cfg(target_os = "macos")]
    crate::touch_macos::actuate(kind);
    #[cfg(not(target_os = "macos"))]
    let _ = kind;
}

/// A quick double click, for celebrations.
pub fn double(kind: Feel) {
    feel(kind);
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(110));
        feel(kind);
    });
}
