// Small helpers shared by both windows.
const T = window.__TAURI__;
export const invoke = T.core.invoke;
export const listen = T.event.listen;
export const win = T.window.getCurrentWindow();
export const currentMonitor = T.window.currentMonitor;
export const { LogicalSize, LogicalPosition } = T.dpi;

// Orb themes. Each gives one [hue, saturation] per finger count, far enough
// apart that 3 and 4 fingers don't look alike, how to shift lightness, and
// the little extras the buddy draws on each orb:
//   sheen   a glint of light that drifts around the glass
//   ember   a warm core that glows and fades
//   pulse   a halo that beats
//   galaxy  "bright" fills each orb with a glowing galaxy, "dark" with deep space
export const THEMES = {
  // Muted: steel, teal, sage, olive, sand, clay, terracotta, platinum, taupe, graphite.
  classic: { label: "Classic", sheen: true, tones: [[210, 26], [186, 24], [150, 18], [92, 18], [42, 32], [22, 32], [6, 26], [220, 6], [32, 14], [200, 10]] },
  // Deeper, moodier versions; text stays light enough to read.
  dusk: { label: "Dusk", ember: true, tones: [[218, 34], [190, 32], [158, 26], [96, 24], [40, 38], [20, 40], [352, 34], [250, 18], [30, 22], [205, 16]],
    light: (l) => Math.round(l >= 80 ? l * 0.92 : l * 0.7) },
  // Saturated candy colors.
  neon: { label: "Neon", sheen: true, pulse: true, tones: [[200, 95], [172, 90], [140, 85], [88, 90], [50, 100], [26, 100], [350, 95], [280, 90], [318, 95], [230, 95]],
    light: (l) => (l >= 80 ? l : l - 10) },
  // Purples, magentas and cyans; the buddy fills each orb with a galaxy.
  cosmic: { label: "Cosmic", galaxy: "bright", tones: [[265, 75], [288, 75], [308, 80], [328, 85], [192, 85], [214, 80], [244, 75], [176, 75], [340, 85], [204, 85]] },
  // Black, quiet space inside each orb, with just a hint of color.
  galaxy: { label: "Galaxy", galaxy: "dark", tones: [[230, 45], [258, 45], [280, 40], [300, 40], [200, 50], [215, 45], [245, 40], [185, 45], [320, 40], [210, 50]],
    light: (l) => Math.round(l >= 80 ? l * 0.9 : l * 0.65) },
};

let theme = THEMES.classic;
export const themeName = () => Object.keys(THEMES).find((k) => THEMES[k] === theme);
export const setTheme = (name) => { theme = THEMES[name] ?? THEMES.classic; };
export const isGalaxy = () => theme.galaxy || false;
export const currentTheme = () => theme;
export const fingerHue = (f) => theme.tones[(f - 1) % theme.tones.length][0];

export const fingerColor = (f, a = 1, light = 76) => {
  const [h, s] = theme.tones[(f - 1) % theme.tones.length];
  const l = theme.light ? theme.light(light) : light;
  return `hsla(${h}, ${s}%, ${l}%, ${a})`;
};

export const slotKey = (f, s) => `${f}-${s}`;
export const parseKey = (k) => k.split("-").map(Number);
export const slotCode = (f, s) => `${f}·${s}`;

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;
