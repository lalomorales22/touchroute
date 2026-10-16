// The fun pack: touches a new install starts with, and that "Add fun pack"
// in settings fills into empty squares. Scripts live in ../starter. Effects
// play through `touchroute fx`; see ipc.rs and ui/fx.js.

pub const FX: &str = include_str!("../starter/fx.js");

/// Bump when the fun pack changes, so existing installs get the new version.
pub const FUN_VERSION: u32 = 2;

/// (key, name, prompt, script)
pub const SLOTS: &[(&str, &str, &str, &str)] = &[
    ("2-1", "Wave hello", "Pop a waving hand", include_str!("../starter/2-1.sh")),
    ("2-2", "Fire", "Flames roar up the screen", include_str!("../starter/2-2.sh")),
    ("2-3", "Confetti cannons", "Confetti cannons", include_str!("../starter/2-3.sh")),
    ("2-4", "Hearts", "Glowing hearts burst out", include_str!("../starter/2-4.sh")),
    ("2-5", "Make it rain", "Money rain", include_str!("../starter/2-5.sh")),
    ("2-6", "Warp speed", "Jump to hyperspace", include_str!("../starter/2-6.sh")),
    ("2-7", "Pizza rain", "Pizza falls from the sky", include_str!("../starter/2-7.sh")),
    ("2-8", "Rocket launch", "Launch a rocket", include_str!("../starter/2-8.sh")),
    ("3-1", "Open Notes", "Open Notes", include_str!("../starter/3-1.sh")),
    ("3-2", "Calculator", "Open Calculator", include_str!("../starter/3-2.sh")),
    ("3-3", "Music", "Open Music", include_str!("../starter/3-3.sh")),
    ("3-4", "Photo Booth", "Open Photo Booth", include_str!("../starter/3-4.sh")),
    ("3-5", "Chess", "Open Chess", include_str!("../starter/3-5.sh")),
    ("3-6", "Stickies", "Open Stickies", include_str!("../starter/3-6.sh")),
    ("3-7", "Weather", "Open Weather", include_str!("../starter/3-7.sh")),
    ("3-8", "Messages", "Open Messages", include_str!("../starter/3-8.sh")),
    ("4-1", "Bubbles", "Soap bubbles float up", include_str!("../starter/4-1.sh")),
    ("4-2", "Fireworks", "Fireworks show", include_str!("../starter/4-2.sh")),
    ("4-3", "Roll a die", "Roll a die and say the number", include_str!("../starter/4-3.sh")),
    ("4-4", "Magic 8 ball", "Ask the magic 8 ball", include_str!("../starter/4-4.sh")),
    ("4-5", "Flip a coin", "Flip a coin", include_str!("../starter/4-5.sh")),
    ("4-6", "Dad joke", "Tell a dad joke", include_str!("../starter/4-6.sh")),
    ("4-7", "Hype me up", "Hype me up", include_str!("../starter/4-7.sh")),
    ("4-8", "Disco", "Disco party", include_str!("../starter/4-8.sh")),
    ("5-1", "The Matrix", "Matrix code rain", include_str!("../starter/5-1.sh")),
    ("5-2", "Galaxy", "A galaxy spins up", include_str!("../starter/5-2.sh")),
    ("5-3", "Let it snow", "Snowfall", include_str!("../starter/5-3.sh")),
    ("5-4", "Portal", "Open a portal", include_str!("../starter/5-4.sh")),
    ("5-6", "Thunderstorm", "Lightning strikes", include_str!("../starter/5-6.sh")),
    ("5-7", "Supernova", "A star explodes", include_str!("../starter/5-7.sh")),
    ("5-8", "Zen mode", "Zen moment", include_str!("../starter/5-8.sh")),
    ("6-1", "Trophy", "You win", include_str!("../starter/6-1.sh")),
    ("6-2", "Wow", "Neon WOW sign", include_str!("../starter/6-2.sh")),
    ("6-3", "Frog rain", "It's raining frogs", include_str!("../starter/6-3.sh")),
    ("6-4", "Boo", "Ghosts float up", include_str!("../starter/6-4.sh")),
    ("6-5", "Taco rain", "Taco rain", include_str!("../starter/6-5.sh")),
    ("6-6", "Birthday", "Happy birthday", include_str!("../starter/6-6.sh")),
    ("6-7", "Shooting star", "Shooting star", include_str!("../starter/6-7.sh")),
    ("6-8", "Grand finale", "Grand finale", include_str!("../starter/6-8.sh")),
];

/// Touches added in the latest fun pack, given to existing installs that use it.
pub const NEW_IN_LATEST: &[(&str, &str, &str, &str)] = &[
    ("5-1", "The Matrix", "Matrix code rain", include_str!("../starter/5-1.sh")),
    ("5-2", "Galaxy", "A galaxy spins up", include_str!("../starter/5-2.sh")),
    ("5-3", "Let it snow", "Snowfall", include_str!("../starter/5-3.sh")),
    ("5-4", "Portal", "Open a portal", include_str!("../starter/5-4.sh")),
    ("5-6", "Thunderstorm", "Lightning strikes", include_str!("../starter/5-6.sh")),
    ("5-7", "Supernova", "A star explodes", include_str!("../starter/5-7.sh")),
];

/// Earlier fun pack scripts and names: (key, old name, old script). A script
/// still exactly like this was never edited, so it is safe to upgrade.
pub const LEGACY: &[(&str, &str, &str)] = &[
    ("2-1", "Wave hello", include_str!("../starter/legacy/2-1.sh")),
    ("2-2", "Fire", include_str!("../starter/legacy/2-2.sh")),
    ("2-3", "Party popper", include_str!("../starter/legacy/2-3.sh")),
    ("2-4", "Floating hearts", include_str!("../starter/legacy/2-4.sh")),
    ("2-5", "Make it rain", include_str!("../starter/legacy/2-5.sh")),
    ("2-6", "Unicorn spin", include_str!("../starter/legacy/2-6.sh")),
    ("2-7", "Pizza rain", include_str!("../starter/legacy/2-7.sh")),
    ("2-8", "Rocket launch", include_str!("../starter/legacy/2-8.sh")),
    ("4-1", "Bubbles", include_str!("../starter/legacy/4-1.sh")),
    ("4-2", "Fireworks", include_str!("../starter/legacy/4-2.sh")),
    ("4-3", "Roll a die", include_str!("../starter/legacy/4-3.sh")),
    ("4-4", "Magic 8 ball", include_str!("../starter/legacy/4-4.sh")),
    ("4-5", "Flip a coin", include_str!("../starter/legacy/4-5.sh")),
    ("4-6", "Dad joke", include_str!("../starter/legacy/4-6.sh")),
    ("4-7", "Hype me up", include_str!("../starter/legacy/4-7.sh")),
    ("4-8", "Disco", include_str!("../starter/legacy/4-8.sh")),
    ("5-8", "Zen mode", include_str!("../starter/legacy/5-8.sh")),
    ("6-1", "Trophy", include_str!("../starter/legacy/6-1.sh")),
    ("6-2", "Wow banner", include_str!("../starter/legacy/6-2.sh")),
    ("6-3", "Frog rain", include_str!("../starter/legacy/6-3.sh")),
    ("6-4", "Boo", include_str!("../starter/legacy/6-4.sh")),
    ("6-5", "Taco rain", include_str!("../starter/legacy/6-5.sh")),
    ("6-6", "Birthday", include_str!("../starter/legacy/6-6.sh")),
    ("6-7", "Shooting star", include_str!("../starter/legacy/6-7.sh")),
    ("6-8", "Grand finale", include_str!("../starter/legacy/6-8.sh")),
];

/// The drawing pack: (id, name, prompt, shape, script).
pub const DRAWINGS: &[(&str, &str, &str, &str, &str)] = &[
    ("heart", "Love", "Hearts burst out", "heart", include_str!("../starter/drawings/heart.sh")),
    ("circle", "Portal", "Open a portal", "circle", include_str!("../starter/drawings/circle.sh")),
    ("check", "Done!", "Confetti for finishing something", "check", include_str!("../starter/drawings/check.sh")),
    ("lightning", "Thunder", "Lightning strikes", "lightning", include_str!("../starter/drawings/lightning.sh")),
    ("star", "Star power", "Fireworks", "star", include_str!("../starter/drawings/star.sh")),
    ("spiral", "Galaxy", "A galaxy swirls", "spiral", include_str!("../starter/drawings/spiral.sh")),
    ("triangle", "Warp", "Hyperspace", "triangle", include_str!("../starter/drawings/triangle.sh")),
];
