// Small helpers shared by both windows.
const T = window.__TAURI__;
export const invoke = T.core.invoke;
export const listen = T.event.listen;
export const win = T.window.getCurrentWindow();
export const currentMonitor = T.window.currentMonitor;
export const { LogicalSize, LogicalPosition } = T.dpi;

// One muted tone per finger count: steel, teal, sage, olive, sand, clay,
// terracotta, platinum, taupe, graphite. Soft enough to read as calm, far
// enough apart that 3 and 4 fingers don't look alike.
const TONES = [[210, 26], [186, 24], [150, 18], [92, 18], [42, 32], [22, 32], [6, 26], [220, 6], [32, 14], [200, 10]];
export const fingerColor = (f, a = 1, light = 76) => {
  const [h, s] = TONES[(f - 1) % TONES.length];
  return `hsla(${h}, ${s}%, ${light}%, ${a})`;
};

export const slotKey = (f, s) => `${f}-${s}`;
export const parseKey = (k) => k.split("-").map(Number);
export const slotCode = (f, s) => `${f}·${s}`;

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;
