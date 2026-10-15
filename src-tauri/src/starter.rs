// The fun pack: touches a new install starts with, and that "Add fun pack"
// in settings fills into empty squares. Scripts live in ../starter.

pub const FX: &str = include_str!("../starter/fx.js");

/// (key, name, prompt, script)
pub const SLOTS: &[(&str, &str, &str, &str)] = &[
    ("2-1", "Wave hello", "Pop a waving hand", include_str!("../starter/2-1.sh")),
    ("2-2", "Fire", "Pop a fire emoji", include_str!("../starter/2-2.sh")),
    ("2-3", "Party popper", "Confetti burst", include_str!("../starter/2-3.sh")),
    ("2-4", "Floating hearts", "Hearts float up", include_str!("../starter/2-4.sh")),
    ("2-5", "Make it rain", "Money rain", include_str!("../starter/2-5.sh")),
    ("2-6", "Unicorn spin", "Spinning unicorn", include_str!("../starter/2-6.sh")),
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
    ("4-1", "Bubbles", "Bubbles float up", include_str!("../starter/4-1.sh")),
    ("4-2", "Fireworks", "Fireworks show", include_str!("../starter/4-2.sh")),
    ("4-3", "Roll a die", "Roll a die and say the number", include_str!("../starter/4-3.sh")),
    ("4-4", "Magic 8 ball", "Ask the magic 8 ball", include_str!("../starter/4-4.sh")),
    ("4-5", "Flip a coin", "Flip a coin", include_str!("../starter/4-5.sh")),
    ("4-6", "Dad joke", "Tell a dad joke", include_str!("../starter/4-6.sh")),
    ("4-7", "Hype me up", "Hype me up", include_str!("../starter/4-7.sh")),
    ("4-8", "Disco", "Disco party", include_str!("../starter/4-8.sh")),
    ("5-8", "Zen mode", "Zen moment", include_str!("../starter/5-8.sh")),
    ("6-1", "Trophy", "You win", include_str!("../starter/6-1.sh")),
    ("6-2", "Wow banner", "Wow banner", include_str!("../starter/6-2.sh")),
    ("6-3", "Frog rain", "It's raining frogs", include_str!("../starter/6-3.sh")),
    ("6-4", "Boo", "Ghosts float up", include_str!("../starter/6-4.sh")),
    ("6-5", "Taco rain", "Taco rain", include_str!("../starter/6-5.sh")),
    ("6-6", "Birthday", "Happy birthday", include_str!("../starter/6-6.sh")),
    ("6-7", "Shooting star", "Shooting star", include_str!("../starter/6-7.sh")),
    ("6-8", "Grand finale", "Grand finale", include_str!("../starter/6-8.sh")),
];
