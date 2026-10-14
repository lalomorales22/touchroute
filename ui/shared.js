// Small helpers shared by both windows.
const T = window.__TAURI__;
export const invoke = T.core.invoke;
export const listen = T.event.listen;
export const win = T.window.getCurrentWindow();
export const currentMonitor = T.window.currentMonitor;
export const { LogicalSize, LogicalPosition } = T.dpi;

export const fingerHue = (f) => (188 + (f - 1) * 19) % 360;
export const fingerColor = (f, a = 1) => `hsla(${fingerHue(f)}, 95%, 68%, ${a})`;

export const slotKey = (f, s) => `${f}-${s}`;
export const parseKey = (k) => k.split("-").map(Number);
export const slotCode = (f, s) => `${f}·${s}`;

export const plural = (n, word, many = word + "s") => `${n} ${n === 1 ? word : many}`;
