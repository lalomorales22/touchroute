// The effects layer. A see-through window over the whole screen that never
// takes clicks. It draws the glowing ink while you draw on the trackpad, and
// plays the effects scripts ask for with `touchroute fx MODE …`.
//
// Each effect is a small function that draws one frame at a time and says
// when it's done. Nothing runs while the screen is quiet.

const { listen } = window.__TAURI__.event;

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FONT = `-apple-system, "SF Pro Rounded", "SF Pro Display", system-ui, sans-serif`;

let W = 0, H = 0;
function resize() {
  // Full resolution is heavy for full-screen glow, and nobody can tell.
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  W = innerWidth; H = innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", resize);
resize();

// ---------- helpers ----------

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = (t) => clamp(t) ** 3;
const easeBack = (t) => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };
const fadeOut = (t, dur, tail = 0.6) => clamp((dur - t) / tail);
const fadeIn = (t, d = 0.25) => clamp(t / d);
const TAU = Math.PI * 2;

// Soft round glows, drawn once per color and reused. Much faster than
// shadowBlur when there are hundreds of them.
const sprites = new Map();
function sprite(color) {
  let c = sprites.get(color);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.18, color);
  grad.addColorStop(0.5, color.replace(/[\d.]+\)$/, "0.25)"));
  grad.addColorStop(1, color.replace(/[\d.]+\)$/, "0)"));
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  sprites.set(color, c);
  return c;
}
// Colors snap to small steps so the glow cache stays a few hundred sprites.
const hsl = (h, s = 100, l = 60, a = 1) =>
  `hsla(${Math.round((((h % 360) + 360) % 360) / 6) * 6}, ${Math.round(s / 10) * 10}%, ${Math.round(l / 4) * 4}%, ${a})`;
function glow(x, y, r, color, alpha = 1) {
  if (alpha <= 0.003 || r <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(sprite(color), x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}

// Emoji drawn once, big, then scaled.
const emojis = new Map();
function emojiImg(e) {
  let c = emojis.get(e);
  if (c) return c;
  c = document.createElement("canvas");
  c.width = c.height = 160;
  const g = c.getContext("2d");
  g.font = `124px "Apple Color Emoji", ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(e, 80, 88);
  emojis.set(e, c);
  return c;
}
function emoji(e, x, y, size, rot = 0, alpha = 1) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.drawImage(emojiImg(e), -size * 0.62, -size * 0.62, size * 1.24, size * 1.24);
  ctx.restore();
}
const splitEmoji = (s, fallback) => {
  const list = (s || "").split(/\s+/).filter(Boolean);
  return list.length ? list : fallback;
};

// Big glowing words for captions. They bounce in, hang, and fade.
function caption(text, t, dur, { y = H * 0.5, size = 0, hue = 0, at = 0, colors } = {}) {
  if (!text) return;
  const k = t - at;
  if (k < 0) return;
  size = size || Math.min(120, Math.max(44, (W * 0.8) / Math.max(4, text.length * 0.62)));
  const s = easeBack(k / 0.5);
  const a = fadeIn(k, 0.15) * fadeOut(t, dur, 0.5);
  ctx.save();
  ctx.translate(W / 2, y + Math.sin(k * 2.2) * 4);
  ctx.scale(s, s);
  ctx.font = `800 ${size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.globalAlpha = a;
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18;
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = "rgba(10,10,20,0.75)";
  ctx.strokeText(text, 0, 0);
  ctx.shadowBlur = 0;
  const grad = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  const [c1, c2] = colors || [hsl(hue + 40 + k * 40, 100, 80), hsl(hue + k * 40, 100, 62)];
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

// A ring of light rolling outward.
function shockwave(x, y, t, { at = 0, dur = 0.8, r0 = 10, r1 = 400, color = "255,255,255", width = 14 } = {}) {
  const k = (t - at) / dur;
  if (k < 0 || k > 1) return;
  const r = r0 + (r1 - r0) * easeOut(k);
  ctx.lineWidth = width * (1 - k) + 1;
  ctx.strokeStyle = `rgba(${color},${0.7 * (1 - k)})`;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
  ctx.lineWidth = width * 2.5 * (1 - k) + 1;
  ctx.strokeStyle = `rgba(${color},${0.18 * (1 - k)})`;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

function flash(alpha, color = "255,255,255") {
  if (alpha <= 0.003) return;
  ctx.fillStyle = `rgba(${color},${alpha})`;
  ctx.fillRect(0, 0, W, H);
}

// Particles: little glowing sparks with gravity, drag and an optional tail.
function spark(o) {
  return { x: 0, y: 0, vx: 0, vy: 0, g: 0, drag: 0.98, life: 1, age: 0, size: 3, hue: 40, sat: 100, light: 65, tail: 0, trail: null, twinkle: false, ...o };
}
function stepSparks(list, dt, { additive = true } = {}) {
  ctx.globalCompositeOperation = additive ? "lighter" : "source-over";
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    p.age += dt;
    if (p.age < 0) continue;
    if (p.age > p.life) { list.splice(i, 1); continue; }
    if (p.tail) { (p.trail ??= []).push(p.x, p.y); if (p.trail.length > p.tail * 2) p.trail.splice(0, 2); }
    p.vx *= Math.pow(p.drag, dt * 60);
    p.vy = p.vy * Math.pow(p.drag, dt * 60) + p.g * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    const k = p.age / p.life;
    let a = 1 - k * k;
    if (p.twinkle && k > 0.5) a *= 0.4 + 0.6 * Math.abs(Math.sin(p.age * 30 + i));
    const color = hsl(p.hue, p.sat, p.light, 1);
    if (p.trail && p.trail.length > 2) {
      ctx.strokeStyle = hsl(p.hue, p.sat, p.light, 0.5 * a);
      ctx.lineWidth = p.size * 0.9;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(p.trail[0], p.trail[1]);
      for (let j = 2; j < p.trail.length; j += 2) ctx.lineTo(p.trail[j], p.trail[j + 1]);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    glow(p.x, p.y, p.size * 3.2, color, a);
  }
  ctx.globalCompositeOperation = "source-over";
}
function burstSparks(list, x, y, n, { speed = [200, 700], hue = [0, 360], life = [0.8, 1.6], size = [2, 4], g = 300, tail = 0, delay = 0, drag = 0.97, twinkle = false } = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, sp = rnd(...speed);
    list.push(spark({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g, drag, tail, twinkle,
      hue: Array.isArray(hue) ? rnd(...hue) : hue, life: rnd(...life), size: rnd(...size), age: -delay }));
  }
}

// ---------- the loop ----------

const running = new Set();
let lastFrame = 0;
let ticking = false;

function play(step) {
  running.add({ step, t: 0 });
  if (!ticking) {
    ticking = true;
    lastFrame = performance.now();
    requestAnimationFrame(loop);
  }
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  ctx.clearRect(0, 0, W, H);
  for (const fx of [...running]) {
    fx.t += dt;
    ctx.save();
    let alive = false;
    try { alive = fx.step(fx.t, dt); } catch (e) { console.error(e); }
    ctx.restore();
    if (!alive) running.delete(fx);
  }
  if (running.size) requestAnimationFrame(loop);
  else { ticking = false; ctx.clearRect(0, 0, W, H); }
}

// ---------- drawn effects ----------

const EFFECTS = {};

// Branching bolts of lightning crack down from the top, lighting the screen.
EFFECTS.lightning = (text) => {
  const bolt = (x0, y0, x1, y1, spread, depth) => {
    let pts = [[x0, y0], [x1, y1]];
    let off = spread;
    for (let i = 0; i < 7; i++) {
      const next = [pts[0]];
      for (let j = 1; j < pts.length; j++) {
        const [ax, ay] = pts[j - 1], [bx, by] = pts[j];
        next.push([(ax + bx) / 2 + rnd(-off, off), (ay + by) / 2 + rnd(-off, off) * 0.3], [bx, by]);
      }
      pts = next;
      off /= 2;
    }
    const branches = [];
    if (depth < 2) {
      for (let i = 0; i < 3 - depth; i++) {
        const [bx, by] = pts[Math.floor(rnd(0.2, 0.7) * pts.length)];
        branches.push(bolt(bx, by, bx + rnd(-260, 260), by + rnd(120, 320), spread * 0.5, depth + 1));
      }
    }
    return { pts, branches, w: 1 - depth * 0.35 };
  };
  const strikes = [0, 0.55, 0.85, 1.6].map((at) => {
    const x = rnd(W * 0.15, W * 0.85);
    return { at, b: bolt(x, -20, x + rnd(-200, 200), rnd(H * 0.65, H * 0.95), 220, 0), hue: rnd(195, 230) };
  });
  const sparks = [];
  const drawBolt = (b, a, hue) => {
    for (const [lw, al, l] of [[26 * b.w, 0.08, 70], [10 * b.w, 0.3, 80], [3.2 * b.w, 1, 97]]) {
      ctx.strokeStyle = hsl(hue, 100, l, al * a);
      ctx.lineWidth = lw;
      ctx.lineJoin = "round";
      ctx.beginPath();
      b.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    b.branches.forEach((c) => drawBolt(c, a * 0.8, hue));
  };
  const dur = 2.8;
  return (t, dt) => {
    let lit = 0;
    for (const s of strikes) {
      const k = t - s.at;
      if (k < 0 || k > 0.7) continue;
      if (!s.hit) {
        s.hit = true;
        const [ex, ey] = s.b.pts[s.b.pts.length - 1];
        burstSparks(sparks, ex, ey, 40, { hue: [190, 230], speed: [150, 600], life: [0.3, 0.9], g: 900 });
      }
      // Flicker hard at first, then fade.
      const a = k < 0.25 ? (Math.random() < 0.7 ? 1 : 0.25) : 1 - (k - 0.25) / 0.45;
      lit = Math.max(lit, k < 0.12 ? 1 - k / 0.12 : 0);
      ctx.globalCompositeOperation = "lighter";
      drawBolt(s.b, a, s.hue);
      const [ex, ey] = s.b.pts[s.b.pts.length - 1];
      glow(ex, ey, 160, hsl(s.hue, 100, 70, 1), a * 0.6);
    }
    ctx.globalCompositeOperation = "source-over";
    flash(lit * 0.22, "200,215,255");
    stepSparks(sparks, dt);
    caption(text, t, dur, { colors: ["#ffffff", "#9ec9ff"], at: 0.1 });
    return t < dur;
  };
};

// Flames roar up from the bottom of the screen, with embers flying.
EFFECTS.fire = (text) => {
  const flames = [], embers = [];
  const dur = 3.4;
  let acc = 0;
  return (t, dt) => {
    const on = t < dur - 0.9;
    acc += dt * (on ? 900 : 0) * (reduced ? 0.3 : 1);
    while (acc > 1) {
      acc--;
      const x = rnd(-20, W + 20);
      flames.push(spark({ x, y: H + 20, vx: rnd(-30, 30), vy: rnd(-520, -260), g: -120, drag: 0.985, life: rnd(0.6, 1.3), size: rnd(14, 34), hue: 45 }));
      if (Math.random() < 0.05) embers.push(spark({ x, y: H, vx: rnd(-90, 90), vy: rnd(-900, -500), g: 200, life: rnd(1, 2), size: rnd(1.5, 3), hue: 35, twinkle: true }));
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = flames.length - 1; i >= 0; i--) {
      const p = flames[i];
      p.age += dt;
      if (p.age > p.life) { flames.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += (p.vx + Math.sin(p.age * 9 + p.y * 0.02) * 60) * dt;
      p.y += p.vy * dt;
      const k = p.age / p.life;
      // White-yellow at the base, through orange and red, to nothing.
      const hue = 52 - k * 50, light = 70 - k * 30;
      glow(p.x, p.y, p.size * (1 + k * 1.8), hsl(hue, 100, light, 1), (1 - k) * 0.55);
    }
    ctx.globalCompositeOperation = "source-over";
    // A hot glow along the bottom edge.
    const heat = fadeIn(t, 0.4) * fadeOut(t, dur, 1);
    const g = ctx.createLinearGradient(0, H, 0, H * 0.55);
    g.addColorStop(0, `rgba(255,120,20,${0.35 * heat})`);
    g.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.55, W, H * 0.45);
    stepSparks(embers, dt);
    caption(text, t, dur, { colors: ["#fff3b0", "#ff6a1a"], at: 0.3 });
    return t < dur || flames.length > 0;
  };
};

function heartPath(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.45, x - s, y - s * 0.05);
  ctx.bezierCurveTo(x - s * 1.45, y + s * 0.45, x - s * 0.6, y + s * 0.95, x, y + s * 1.3);
  ctx.bezierCurveTo(x + s * 0.6, y + s * 0.95, x + s * 1.45, y + s * 0.45, x + s, y - s * 0.05);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.45, x, y, x, y + s * 0.3);
  ctx.closePath();
}
function heart(x, y, s, hue, alpha, rot = 0) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.globalAlpha = alpha;
  glow(0, s * 0.5, s * 2.6, hsl(hue, 100, 65, 1), 0.5);
  const g = ctx.createLinearGradient(0, -s * 0.4, 0, s * 1.3);
  g.addColorStop(0, hsl(hue + 15, 100, 78));
  g.addColorStop(1, hsl(hue - 10, 95, 52));
  ctx.fillStyle = g;
  heartPath(0, -s * 0.4, s);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.ellipse(-s * 0.48, -s * 0.15, s * 0.22, s * 0.13, -0.6, 0, TAU); ctx.fill();
  ctx.restore();
}

// A big heart beats twice, then bursts into glowing hearts that drift away.
EFFECTS.hearts = (text) => {
  const cx = W / 2, cy = H / 2;
  const hearts = [];
  const sparks = [];
  const dur = 4;
  let burst = false;
  return (t, dt) => {
    if (t < 1.0) {
      const beat = 1 + 0.18 * Math.max(Math.sin(t * TAU * 1.8), 0) ** 3;
      heart(cx, cy, 70 * easeBack(t / 0.35) * beat, 345, 1);
    } else if (!burst) {
      burst = true;
      for (let i = 0; i < 46; i++) {
        const a = rnd(0, TAU), sp = rnd(150, 900);
        hearts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120, s: rnd(10, 34), hue: pick([330, 345, 355, 300, 15]), rot: rnd(-0.4, 0.4), ph: rnd(0, TAU) });
      }
      burstSparks(sparks, cx, cy, 80, { hue: [320, 360], speed: [200, 900], g: 200, life: [0.6, 1.4] });
    }
    shockwave(cx, cy, t, { at: 1.0, dur: 0.9, r1: Math.max(W, H) * 0.45, color: "255,140,190" });
    for (const h of hearts) {
      h.vx *= Math.pow(0.95, dt * 60);
      h.vy = h.vy * Math.pow(0.95, dt * 60) - 40 * dt;
      h.x += (h.vx + Math.sin(t * 3 + h.ph) * 30) * dt;
      h.y += h.vy * dt;
      heart(h.x, h.y, h.s * (1 + 0.08 * Math.sin(t * 8 + h.ph)), h.hue, fadeOut(t, dur, 1), h.rot + Math.sin(t * 2 + h.ph) * 0.2);
    }
    stepSparks(sparks, dt);
    caption(text, t, dur, { at: 1.0, y: H * 0.72, colors: ["#ffe0ee", "#ff5c9a"] });
    return t < dur;
  };
};

// Stars stretch into streaks: jump to hyperspace.
EFFECTS.warp = (text) => {
  const cx = W / 2, cy = H / 2;
  const stars = Array.from({ length: 700 }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: rnd(0.1, 1), hue: rnd(190, 260) }));
  const dur = 3;
  return (t, dt) => {
    // Ease into light speed, hold, then drop out.
    const speed = t < 1.5 ? 0.05 + easeIn(t / 1.5) * 3.2 : t < 2.2 ? 3.2 : 3.2 * (1 - easeOut((t - 2.2) / 0.6));
    const a = fadeIn(t, 0.3) * fadeOut(t, dur, 0.5);
    flash(0.35 * a, "0,0,12");
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (const s of stars) {
      const pz = s.z;
      s.z -= speed * dt;
      if (s.z <= 0.02) { s.z = 1; s.x = rnd(-1, 1); s.y = rnd(-1, 1); continue; }
      const f = Math.max(W, H) * 0.5;
      const x1 = cx + (s.x / s.z) * f, y1 = cy + (s.y / s.z) * f;
      const x0 = cx + (s.x / Math.min(1, pz + speed * 0.04)) * f, y0 = cy + (s.y / Math.min(1, pz + speed * 0.04)) * f;
      const b = clamp(1 - s.z);
      ctx.strokeStyle = hsl(s.hue, 80, 75 + b * 20, b * a);
      ctx.lineWidth = 0.6 + b * 2.4;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.globalCompositeOperation = "source-over";
    glow(cx, cy, 200 + speed * 60, hsl(220, 100, 70, 1), 0.35 * a);
    flash(t > 2.15 && t < 2.5 ? (1 - Math.abs(t - 2.25) / 0.25) * 0.5 : 0, "220,235,255");
    caption(text, t, dur, { at: 2.2, colors: ["#ffffff", "#8fb8ff"] });
    return t < dur;
  };
};

// Green code rains down the screen, then a message types itself out.
EFFECTS.matrix = (text) => {
  const size = 18;
  const cols = Math.ceil(W / size);
  const glyphs = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:=*+<>".split("");
  const drops = Array.from({ length: cols }, () => ({ y: rnd(-H, 0), v: rnd(250, 700), len: Math.floor(rnd(8, 26)), chars: [] }));
  const dur = 4.6;
  const msg = (text || "").toUpperCase();
  return (t, dt) => {
    const a = fadeIn(t, 0.4) * fadeOut(t, dur, 0.8);
    flash(0.55 * a, "0,6,2");
    ctx.font = `600 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
    ctx.textAlign = "center";
    drops.forEach((d, i) => {
      d.y += d.v * dt;
      if (d.y - d.len * size > H) { d.y = rnd(-200, 0); d.v = rnd(250, 700); }
      const x = i * size + size / 2;
      for (let j = 0; j < d.len; j++) {
        const y = Math.floor(d.y / size) * size - j * size;
        if (y < -size || y > H + size) continue;
        if (!d.chars[j] || Math.random() < 0.04) d.chars[j] = pick(glyphs);
        ctx.fillStyle = j === 0 ? `rgba(220,255,230,${a})` : `rgba(40,255,110,${a * (1 - j / d.len) * 0.85})`;
        ctx.fillText(d.chars[j], x, y);
      }
    });
    if (msg && t > 1.2) {
      const shown = msg.slice(0, Math.floor((t - 1.2) * 9));
      ctx.font = `700 ${Math.min(90, W / Math.max(6, msg.length * 0.7))}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(40,255,110,0.9)";
      ctx.shadowBlur = 24;
      ctx.fillStyle = `rgba(210,255,220,${a})`;
      const cursor = Math.floor(t * 3) % 2 ? "█" : " ";
      ctx.fillText(shown + (shown.length < msg.length || cursor === "█" ? cursor : " "), W / 2, H / 2);
      ctx.shadowBlur = 0;
    }
    return t < dur;
  };
};

const CONFETTI = [[350, 90, 62], [45, 100, 58], [195, 95, 55], [130, 75, 50], [280, 85, 65], [20, 100, 60], [55, 100, 70]];

// Two cannons at the bottom corners blast confetti that flutters down.
EFFECTS.confetti = (text) => {
  const bits = [];
  const fire = (x, dir, at) => {
    for (let i = 0; i < 160; i++) {
      const a = -Math.PI / 2 + dir * rnd(0.12, 0.7), sp = rnd(1100, 2300);
      const [h, s, l] = pick(CONFETTI);
      bits.push({ x, y: H + 10, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, at, h, s, l,
        w: rnd(11, 20), hgt: rnd(6, 11), rot: rnd(0, TAU), vr: rnd(-12, 12), flip: rnd(0, TAU), vf: rnd(6, 16), round: Math.random() < 0.15 });
    }
  };
  fire(0, 1, 0);
  fire(W, -1, 0.12);
  const sparks = [];
  burstSparks(sparks, 30, H - 10, 30, { hue: [30, 60], speed: [200, 600], life: [0.3, 0.7] });
  burstSparks(sparks, W - 30, H - 10, 30, { hue: [30, 60], speed: [200, 600], life: [0.3, 0.7], delay: 0.12 });
  const dur = 5;
  return (t, dt) => {
    for (const b of bits) {
      if (t < b.at) continue;
      const drag = Math.pow(0.975, dt * 60);
      b.vx *= drag;
      b.vy = b.vy * drag + 1400 * dt * (b.vy > 140 ? 0.15 : 1);
      if (b.vy > 160) b.vy = 160 + Math.sin(t * 5 + b.flip) * 30; // flutter at terminal speed
      b.x += (b.vx + Math.sin(t * 4 + b.flip) * 40) * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      b.flip += b.vf * dt;
      const sy = Math.cos(b.flip);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.scale(1, sy);
      ctx.globalAlpha = fadeOut(t, dur, 0.8);
      ctx.fillStyle = hsl(b.h, b.s, b.l * (0.75 + 0.25 * Math.abs(sy)));
      if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.hgt * 0.7, 0, TAU); ctx.fill(); }
      else ctx.fillRect(-b.w / 2, -b.hgt / 2, b.w, b.hgt);
      ctx.restore();
    }
    stepSparks(sparks, dt);
    caption(text, t, dur, { at: 0.3, y: H * 0.42 });
    return t < dur;
  };
};

// Rockets climb with sparkling tails and burst into glowing shells.
EFFECTS.fireworks = (text) => {
  const rockets = [], sparks = [], flashes = [];
  const shells = 9;
  for (let i = 0; i < shells; i++) {
    rockets.push({ at: i * 0.32 + rnd(0, 0.15), x: rnd(W * 0.12, W * 0.88), y: H + 10, tx: 0, ty: rnd(H * 0.12, H * 0.45), hue: rnd(0, 360), kind: pick(["peony", "peony", "ring", "willow", "crackle"]), done: false });
  }
  rockets.forEach((r) => (r.tx = r.x + rnd(-80, 80)));
  const dur = 5.2;
  return (t, dt) => {
    for (const r of rockets) {
      const k = (t - r.at) / 0.85;
      if (k < 0 || r.done) continue;
      const e = easeOut(k);
      const x = r.x + (r.tx - r.x) * e, y = r.y + (r.ty - r.y) * e;
      sparks.push(spark({ x, y, vx: rnd(-30, 30), vy: rnd(40, 120), g: 200, life: rnd(0.3, 0.6), size: 1.6, hue: 40, light: 70 }));
      ctx.globalCompositeOperation = "lighter";
      glow(x, y, 10, hsl(40, 100, 75, 1), 1);
      ctx.globalCompositeOperation = "source-over";
      if (k >= 1) {
        r.done = true;
        flashes.push({ x, y, t, hue: r.hue });
        if (r.kind === "ring") {
          for (let i = 0; i < 70; i++) {
            const a = (i / 70) * TAU;
            sparks.push(spark({ x, y, vx: Math.cos(a) * 420, vy: Math.sin(a) * 420 * 0.6, g: 160, drag: 0.96, life: 1.6, size: 2.6, hue: r.hue, tail: 6 }));
          }
        } else if (r.kind === "willow") {
          burstSparks(sparks, x, y, 110, { hue: [38, 48], speed: [100, 420], g: 220, drag: 0.975, life: [2, 3], size: [1.6, 2.6], tail: 14, twinkle: true });
        } else {
          burstSparks(sparks, x, y, 120, { hue: [r.hue - 20, r.hue + 20], speed: [80, 520], g: 230, drag: 0.965, life: [1.1, 1.9], size: [2, 3.4], tail: 5, twinkle: r.kind === "crackle" });
          burstSparks(sparks, x, y, 40, { hue: [r.hue + 160, r.hue + 200], speed: [40, 200], g: 200, life: [0.8, 1.3], size: [1.5, 2.5] });
        }
      }
    }
    ctx.globalCompositeOperation = "lighter";
    for (const f of flashes) {
      const k = (t - f.t) / 0.5;
      if (k < 1) glow(f.x, f.y, 260 * (0.5 + k), hsl(f.hue, 100, 70, 1), 0.7 * (1 - k));
    }
    ctx.globalCompositeOperation = "source-over";
    stepSparks(sparks, dt);
    caption(text, t, dur, { at: 1.2, y: H * 0.7 });
    return t < dur || sparks.length > 0;
  };
};

// A star collapses to a point, then explodes in shockwaves and stardust.
EFFECTS.supernova = (text) => {
  const cx = W / 2, cy = H / 2;
  const sparks = [], inflow = [];
  for (let i = 0; i < 140; i++) {
    const a = rnd(0, TAU), r = rnd(200, Math.max(W, H) * 0.6);
    inflow.push({ a, r, r0: r, hue: rnd(180, 300), at: rnd(0, 0.4) });
  }
  const dur = 4.2;
  const BANG = 1.1;
  let banged = false;
  const clouds = Array.from({ length: 8 }, () => ({ a: rnd(0, TAU), d: rnd(40, 220), r: rnd(160, 340), hue: rnd(180, 340) }));
  return (t, dt) => {
    ctx.globalCompositeOperation = "lighter";
    if (t < BANG) {
      // Everything rushes in and the core gets hotter.
      for (const p of inflow) {
        const k = clamp((t - p.at) / (BANG - p.at));
        const r = p.r0 * (1 - easeIn(k));
        glow(cx + Math.cos(p.a + k * 2) * r, cy + Math.sin(p.a + k * 2) * r, 6, hsl(p.hue, 100, 70, 1), k);
      }
      const k = t / BANG;
      glow(cx, cy, 60 + 40 * Math.sin(t * 40) * k, hsl(200, 100, 80, 1), 0.4 + 0.6 * k);
    } else if (!banged) {
      banged = true;
      burstSparks(sparks, cx, cy, 320, { hue: [170, 330], speed: [200, 1500], g: 0, drag: 0.955, life: [1.2, 2.6], size: [1.6, 4], tail: 7, twinkle: true });
      burstSparks(sparks, cx, cy, 80, { hue: [30, 55], speed: [100, 500], g: 0, drag: 0.95, life: [1, 2], size: [3, 5] });
    }
    const after = t - BANG;
    if (after > 0) {
      // Glowing nebula clouds that bloom and fade.
      for (const c of clouds) {
        const k = clamp(after / 2.4);
        glow(cx + Math.cos(c.a) * c.d * (1 + k), cy + Math.sin(c.a) * c.d * (1 + k), c.r * (0.4 + k), hsl(c.hue, 90, 55, 1), 0.35 * (1 - k));
      }
      glow(cx, cy, 120 * (1 - clamp(after / 1.2)) + 20, "rgba(255,255,255,1)", 1 - clamp(after / 1.2));
    }
    ctx.globalCompositeOperation = "source-over";
    flash(after > 0 && after < 0.35 ? 0.75 * (1 - after / 0.35) : 0);
    shockwave(cx, cy, t, { at: BANG, dur: 1.2, r1: Math.max(W, H) * 0.75, color: "170,210,255", width: 22 });
    shockwave(cx, cy, t, { at: BANG + 0.15, dur: 1.4, r1: Math.max(W, H) * 0.6, color: "255,150,230", width: 14 });
    shockwave(cx, cy, t, { at: BANG + 0.3, dur: 1.5, r1: Math.max(W, H) * 0.45, color: "255,220,140", width: 8 });
    stepSparks(sparks, dt);
    caption(text, t, dur, { at: BANG + 0.3 });
    return t < dur || sparks.length > 0;
  };
};

// A swirling ring tears open in the middle of the screen, spits sparks, and snaps shut.
EFFECTS.portal = (text) => {
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.22;
  const sparks = [], motes = [];
  const dur = 3.6;
  const hues = [pick([28, 200, 280, 140]), 0];
  hues[1] = hues[0] + 160;
  return (t, dt) => {
    const open = t < 0.6 ? easeBack(t / 0.6) : t < dur - 0.6 ? 1 : 1 - easeIn((t - (dur - 0.6)) / 0.5);
    const r = R * Math.max(0, open);
    if (r > 2) {
      // The inside: a dark well with a slow swirl.
      ctx.save();
      ctx.beginPath(); ctx.ellipse(cx, cy, r, r * 1.08, 0, 0, TAU); ctx.clip();
      const well = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      well.addColorStop(0, "rgba(0,0,0,0.9)");
      well.addColorStop(0.7, hsl(hues[1], 70, 18, 0.85));
      well.addColorStop(1, hsl(hues[1], 90, 45, 0.9));
      ctx.fillStyle = well;
      ctx.fillRect(cx - r, cy - r * 1.1, r * 2, r * 2.2);
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = hsl(hues[1] + i * 10, 100, 65, 0.25);
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let k = 0; k < 40; k++) {
          const a = k * 0.25 - t * 3 + (i * TAU) / 6, rr = (k / 40) * r;
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 1.08;
          k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
      // The rim: lots of bright arcs spinning at different speeds.
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 26; i++) {
        const a0 = t * (3 + (i % 5)) * (i % 2 ? 1 : -1) + i;
        const rr = r * (1 + Math.sin(i * 7.3) * 0.05);
        ctx.strokeStyle = hsl(hues[0] + (i % 4) * 8, 100, 55 + (i % 3) * 12, 0.75);
        ctx.lineWidth = 2 + (i % 4);
        ctx.beginPath(); ctx.ellipse(cx, cy, rr, rr * 1.08, 0, a0, a0 + 0.6 + (i % 3) * 0.4); ctx.stroke();
      }
      glow(cx, cy, r * 1.6, hsl(hues[0], 100, 55, 1), 0.35 * open);
      ctx.globalCompositeOperation = "source-over";
      // Sparks fly off the rim, and motes get pulled in.
      if (t < dur - 0.6) {
        for (let i = 0; i < 6; i++) {
          const a = rnd(0, TAU);
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 1.08;
          sparks.push(spark({ x, y, vx: -Math.sin(a) * 500 + Math.cos(a) * 120, vy: Math.cos(a) * 500 + Math.sin(a) * 120, g: 600, drag: 0.96, life: rnd(0.4, 0.9), size: rnd(1.5, 3), hue: hues[0] + rnd(-10, 20) }));
        }
        if (Math.random() < 0.5) motes.push({ a: rnd(0, TAU), d: rnd(1.6, 3) * R, hue: hues[1] });
      }
    }
    if (t > dur - 0.15 && !sparks.closed) {
      sparks.closed = true;
      burstSparks(sparks, cx, cy, 90, { hue: [hues[0] - 20, hues[0] + 20], speed: [200, 900], g: 0, drag: 0.94, life: [0.5, 1] });
    }
    ctx.globalCompositeOperation = "lighter";
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.d -= 260 * dt;
      m.a += 2.5 * dt;
      if (m.d < r * 0.4) { motes.splice(i, 1); continue; }
      glow(cx + Math.cos(m.a) * m.d, cy + Math.sin(m.a) * m.d, 7, hsl(m.hue, 100, 70, 1), 0.9);
    }
    ctx.globalCompositeOperation = "source-over";
    stepSparks(sparks, dt);
    caption(text, t, dur, { at: 0.6, y: cy + R + 90 });
    return t < dur || sparks.length > 0;
  };
};

// Northern lights ripple across the top of the screen over twinkling stars.
EFFECTS.aurora = (text) => {
  const ribbons = Array.from({ length: 4 }, (_, i) => ({ y: H * (0.18 + i * 0.07), amp: rnd(30, 80), f: rnd(1.5, 3.2), sp: rnd(0.3, 0.7), hue: [140, 165, 190, 285][i], ph: rnd(0, TAU) }));
  const stars = Array.from({ length: 140 }, () => ({ x: rnd(0, W), y: rnd(0, H * 0.6), r: rnd(0.5, 1.6), ph: rnd(0, TAU) }));
  const dur = 7;
  return (t) => {
    const a = fadeIn(t, 1.2) * fadeOut(t, dur, 1.6);
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    sky.addColorStop(0, `rgba(2,6,24,${0.55 * a})`);
    sky.addColorStop(1, "rgba(2,6,24,0)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H * 0.75);
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${a * (0.3 + 0.7 * Math.abs(Math.sin(t * 1.5 + s.ph)))})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = "lighter";
    for (const rb of ribbons) {
      // Many thin vertical curtains along a wavy line, bright at the bottom edge.
      for (let x = -20; x < W + 20; x += 7) {
        const k = x / W;
        const y = rb.y + Math.sin(k * TAU * rb.f + t * rb.sp + rb.ph) * rb.amp + Math.sin(k * 17 + t * 1.3) * 12;
        const h = 120 + 90 * Math.sin(k * 9 + t * 0.8 + rb.ph);
        const g = ctx.createLinearGradient(0, y - h, 0, y);
        g.addColorStop(0, hsl(rb.hue + 40, 90, 60, 0));
        g.addColorStop(0.75, hsl(rb.hue + k * 40, 95, 60, 0.12 * a));
        g.addColorStop(1, hsl(rb.hue, 100, 75, 0.32 * a));
        ctx.fillStyle = g;
        ctx.fillRect(x, y - h, 7, h);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    if (text) {
      const k = clamp((t - 1.2) / 1.5) * fadeOut(t, dur, 1.6);
      ctx.font = `200 ${Math.min(110, W / 9)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(120,255,200,0.8)";
      ctx.shadowBlur = 30;
      ctx.fillStyle = `rgba(235,255,248,${k * (0.75 + 0.25 * Math.sin(t * 1.6))})`;
      // The word breathes with you: in for 4, out for 4.
      ctx.save();
      ctx.translate(W / 2, H * 0.55);
      const breath = 1 + 0.08 * Math.sin(t * (TAU / 8) - Math.PI / 2);
      ctx.scale(breath, breath);
      ctx.fillText(text, 0, 0);
      ctx.restore();
      ctx.shadowBlur = 0;
    }
    return t < dur;
  };
};

// A neon sign buzzes and flickers to life.
EFFECTS.neon = (text) => {
  text = (text || "WOW").toUpperCase();
  const size = Math.min(220, Math.max(60, (W * 0.82) / (text.length * 0.66)));
  const hue = pick([320, 190, 280, 140, 30]);
  const sparks = [];
  const dur = 3.8;
  // When the tube is on: stutters at first, then holds with an odd buzz.
  const on = (t) => {
    if (t < 0.15) return 0;
    if (t < 0.9) return Math.random() < 0.45 ? 1 : 0.08;
    return Math.random() < 0.02 ? 0.35 : 1;
  };
  let lit = false;
  return (t, dt) => {
    const a = on(t) * fadeOut(t, dur, 0.5);
    if (t > 0.9 && !lit) {
      lit = true;
      burstSparks(sparks, W / 2, H / 2, 90, { hue: [hue - 15, hue + 15], speed: [200, 900], g: 500, life: [0.5, 1.1] });
    }
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(-0.04);
    // An unlit tube shows faintly so the flicker reads as a real sign.
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeText(text, 0, 0);
    if (a > 0.02) {
      ctx.globalCompositeOperation = "lighter";
      for (const [blur, w, l, al] of [[60, 14, 55, 0.55], [26, 8, 62, 0.8], [8, 4, 80, 1]]) {
        ctx.shadowColor = hsl(hue, 100, 55, 1);
        ctx.shadowBlur = blur;
        ctx.lineWidth = w;
        ctx.strokeStyle = hsl(hue, 100, l, al * a);
        ctx.strokeText(text, 0, 0);
      }
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.strokeText(text, 0, 0);
      // Light spilling onto the "wall" below.
      ctx.globalCompositeOperation = "source-over";
      glow(0, size * 0.3, size * 3, hsl(hue, 100, 55, 1), 0.18 * a);
    }
    ctx.restore();
    stepSparks(sparks, dt);
    return t < dur;
  };
};

// Shiny soap bubbles drift up, wobbling, and pop into droplets.
EFFECTS.bubbles = () => {
  const bubbles = Array.from({ length: 34 }, () => ({
    x: rnd(0, W), y: H + rnd(40, H * 0.7), r: rnd(18, 70), v: rnd(90, 220), ph: rnd(0, TAU), hue: rnd(0, 360), popAt: rnd(1.5, 5.5),
  }));
  const drops = [];
  const dur = 6.5;
  return (t, dt) => {
    for (const b of bubbles) {
      if (b.popped) continue;
      b.y -= b.v * dt;
      const x = b.x + Math.sin(t * 1.4 + b.ph) * 26;
      if (t > b.popAt && b.y < H * 0.85) {
        b.popped = true;
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * TAU;
          drops.push(spark({ x: x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, g: 600, life: 0.5, size: 1.6, hue: b.hue + i * 20, light: 80 }));
        }
        continue;
      }
      const sq = 1 + Math.sin(t * 5 + b.ph) * 0.04;
      ctx.save();
      ctx.translate(x, b.y);
      ctx.scale(sq, 2 - sq);
      ctx.globalAlpha = fadeOut(t, dur, 0.8);
      const body = ctx.createRadialGradient(0, 0, b.r * 0.6, 0, 0, b.r);
      body.addColorStop(0, "rgba(255,255,255,0.02)");
      body.addColorStop(1, "rgba(255,255,255,0.16)");
      ctx.fillStyle = body;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, TAU); ctx.fill();
      // Rainbow film sliding around the rim.
      for (let i = 0; i < 6; i++) {
        const a0 = t * 0.8 + b.ph + i * 1.05;
        ctx.strokeStyle = hsl(b.hue + i * 60 + t * 60, 100, 70, 0.55);
        ctx.lineWidth = Math.max(1.5, b.r * 0.08);
        ctx.beginPath(); ctx.arc(0, 0, b.r * 0.95, a0, a0 + 0.9); ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath(); ctx.ellipse(-b.r * 0.4, -b.r * 0.42, b.r * 0.22, b.r * 0.12, -0.7, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath(); ctx.arc(b.r * 0.35, b.r * 0.4, b.r * 0.07, 0, TAU); ctx.fill();
      ctx.restore();
    }
    stepSparks(drops, dt);
    return t < dur;
  };
};

// A spiral galaxy gathers out of stardust, spins, and scatters.
EFFECTS.galaxy = (text) => {
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.36;
  const arms = Math.random() < 0.5 ? 2 : 3;
  const hueA = rnd(180, 300);
  const stars = Array.from({ length: 1600 }, (_, i) => {
    const k = Math.pow(Math.random(), 0.7);
    const arm = i % arms;
    const a = arm * (TAU / arms) + k * 5.2 + rnd(-0.35, 0.35) * (1 - k * 0.5);
    return { k, a, r: k * R + rnd(-14, 14), sx: rnd(-W * 0.2, W * 1.2), sy: rnd(-H * 0.2, H * 1.2), hue: hueA + k * 120 + rnd(-20, 20), size: rnd(1.4, 3.6), bright: Math.random() < 0.12 };
  });
  const dur = 5.5;
  return (t) => {
    const form = easeOut(t / 1.4);
    const scatter = easeIn((t - (dur - 1.2)) / 1.2);
    const a = fadeIn(t, 0.3) * (1 - scatter);
    ctx.globalCompositeOperation = "lighter";
    glow(cx, cy, R * 1.3, hsl(hueA, 90, 50, 1), 0.45 * a * form);
    glow(cx, cy, R * 0.35, "rgba(255,240,220,1)", a * form);
    const tilt = 0.55;
    for (const s of stars) {
      // Inner stars go round faster, like the real thing.
      const ang = s.a + t * (1.4 - s.k * 0.9);
      let x = cx + Math.cos(ang) * s.r * (1 + scatter * 2);
      let y = cy + Math.sin(ang) * s.r * tilt * (1 + scatter * 2);
      x = s.sx + (x - s.sx) * form;
      y = s.sy + (y - s.sy) * form;
      if (s.bright) glow(x, y, s.size * 4, hsl(s.hue, 100, 70, 1), a * 0.9);
      else {
        ctx.fillStyle = hsl(s.hue, 90, 70 + (1 - s.k) * 25, a * (0.6 + 0.4 * (1 - s.k)));
        ctx.fillRect(x - s.size / 2, y - s.size / 2, s.size, s.size);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    caption(text, t, dur, { at: 1.4, y: cy + R * tilt + 80 });
    return t < dur;
  };
};

// The room goes dark, a mirror ball spins, and colored beams sweep the screen.
EFFECTS.disco = (text) => {
  const bx = W / 2, by = Math.min(150, H * 0.16), br = 54;
  const beams = Array.from({ length: 8 }, (_, i) => ({ hue: (i * 45 + rnd(0, 30)) % 360, sp: rnd(0.6, 1.4) * (i % 2 ? 1 : -1), ph: rnd(0, TAU) }));
  const spots = Array.from({ length: 50 }, () => ({ a: rnd(0, TAU), d: rnd(0.2, 1), hue: rnd(0, 360), s: rnd(3, 7) }));
  const dur = 6;
  return (t) => {
    const a = fadeIn(t, 0.5) * fadeOut(t, dur, 0.8);
    flash(0.45 * a, "4,0,14");
    // Beams from the ball.
    ctx.globalCompositeOperation = "lighter";
    for (const b of beams) {
      const ang = Math.PI / 2 + Math.sin(t * b.sp + b.ph) * 1.1;
      const len = Math.hypot(W, H);
      const spread = 0.09;
      const g = ctx.createLinearGradient(bx, by, bx + Math.cos(ang) * len, by + Math.sin(ang) * len);
      g.addColorStop(0, hsl(b.hue, 100, 65, 0.5 * a));
      g.addColorStop(1, hsl(b.hue, 100, 65, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(ang - spread) * len, by + Math.sin(ang - spread) * len);
      ctx.lineTo(bx + Math.cos(ang + spread) * len, by + Math.sin(ang + spread) * len);
      ctx.closePath();
      ctx.fill();
      const px = bx + Math.cos(ang) * H * 0.75, py = by + Math.sin(ang) * H * 0.75;
      glow(px, py, 140, hsl(b.hue, 100, 60, 1), 0.45 * a);
    }
    // Little reflections drifting across everything.
    for (const s of spots) {
      const ang = s.a + t * 0.6;
      glow(W / 2 + Math.cos(ang) * W * 0.5 * s.d, H * 0.55 + Math.sin(ang * 1.3) * H * 0.4 * s.d, s.s * 3, hsl(s.hue + t * 90, 100, 75, 1), a * 0.9);
    }
    ctx.globalCompositeOperation = "source-over";
    // The mirror ball itself, tiles catching the light as it turns.
    ctx.save();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(200,200,210,0.8)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, by - br); ctx.stroke();
    ctx.beginPath(); ctx.arc(bx, by, br, 0, TAU); ctx.clip();
    ctx.fillStyle = "#3a3d48";
    ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    const tile = 9;
    for (let row = -6; row <= 6; row++) {
      const y = by + row * tile;
      const w = Math.sqrt(Math.max(0, br * br - (row * tile) ** 2));
      for (let col = -8; col <= 8; col++) {
        const x = bx + ((col * tile + (t * 30) % tile) / br) * w;
        const shine = 0.5 + 0.5 * Math.sin(col * 1.7 + row * 2.3 + t * 6);
        ctx.fillStyle = hsl((col * 40 + row * 25 + t * 120) % 360, 40 + shine * 60, 45 + shine * 45);
        ctx.fillRect(x - tile * 0.45, y - tile * 0.45, tile * 0.85, tile * 0.85);
      }
    }
    ctx.restore();
    ctx.globalCompositeOperation = "lighter";
    glow(bx + Math.cos(t * 3) * br * 0.5, by - br * 0.3, 40, "rgba(255,255,255,1)", a * (0.6 + 0.4 * Math.sin(t * 9)));
    ctx.globalCompositeOperation = "source-over";
    caption(text, t, dur, { at: 0.6, y: H * 0.62 });
    return t < dur;
  };
};

// Snow drifts down; the big flakes are real six-armed crystals.
EFFECTS.snow = (text) => {
  const flakes = Array.from({ length: 260 }, () => {
    const r = Math.random() < 0.15 ? rnd(10, 22) : rnd(2, 5.5);
    return { x: rnd(0, W), y: rnd(-H, 0), r, v: 30 + r * rnd(10, 18), ph: rnd(0, TAU), rot: rnd(0, TAU), vr: rnd(-1, 1) };
  });
  const dur = 7;
  const crystal = (r) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -r);
      ctx.moveTo(0, -r * 0.55); ctx.lineTo(-r * 0.25, -r * 0.75);
      ctx.moveTo(0, -r * 0.55); ctx.lineTo(r * 0.25, -r * 0.75);
      ctx.rotate(TAU / 6);
    }
    ctx.stroke();
  };
  return (t, dt) => {
    const a = fadeIn(t, 0.6) * fadeOut(t, dur, 1.2);
    for (const f of flakes) {
      f.y += f.v * dt;
      f.rot += f.vr * dt;
      if (f.y > H + 20) { f.y = -20; f.x = rnd(0, W); }
      const x = f.x + Math.sin(t * 0.9 + f.ph) * 30;
      if (f.r > 6) {
        ctx.save();
        ctx.translate(x, f.y);
        ctx.rotate(f.rot);
        ctx.strokeStyle = `rgba(235,245,255,${0.9 * a})`;
        ctx.lineWidth = 1.6;
        ctx.lineCap = "round";
        ctx.shadowColor = "rgba(160,200,255,0.9)";
        ctx.shadowBlur = 8;
        crystal(f.r);
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(245,250,255,${a * 0.85})`;
        ctx.beginPath(); ctx.arc(x, f.y, f.r, 0, TAU); ctx.fill();
      }
    }
    caption(text, t, dur, { at: 0.8, colors: ["#ffffff", "#bcd8ff"] });
    return t < dur;
  };
};

// ---------- emoji effects ----------

// One big emoji bounces in with a shockwave and a ring of sparkles.
EFFECTS.pop = (list, text, spin = false) => {
  const e = pick(splitEmoji(list, ["🎉"]));
  const cx = W / 2, cy = H / 2 - 30;
  const sparks = [];
  burstSparks(sparks, cx, cy, 70, { speed: [300, 1000], g: 400, life: [0.6, 1.3], delay: 0.18, tail: 4 });
  const dur = 2.6;
  const ghosts = [];
  return (t, dt) => {
    const grow = easeBack(t / 0.5);
    const size = 220 * grow * (1 + 0.04 * Math.sin(t * 7));
    const rot = spin ? t * 9 * (1 - clamp((t - 1.6) / 0.6)) + easeOut(t / 2) * 0 : Math.sin(t * 6) * 0.14 * (1 - t / dur);
    const a = fadeOut(t, dur, 0.5);
    ctx.globalCompositeOperation = "lighter";
    glow(cx, cy, size * 1.4, hsl(t * 80, 100, 65, 1), 0.35 * a);
    ctx.globalCompositeOperation = "source-over";
    shockwave(cx, cy, t, { at: 0.12, dur: 0.8, r1: 520 });
    if (spin) {
      ghosts.push(rot);
      if (ghosts.length > 5) ghosts.shift();
      ghosts.forEach((g, i) => emoji(e, cx, cy, size, g, a * 0.12 * (i + 1)));
    }
    stepSparks(sparks, dt);
    emoji(e, cx, cy, size, rot, a);
    caption(text, t, dur, { at: 0.25, y: cy + 190 });
    return t < dur;
  };
};
EFFECTS.spin = (list, text) => EFFECTS.pop(list, text, true);

// Emoji pour down with motion blur and tumble.
EFFECTS.rain = (list, text) => {
  const set = splitEmoji(list, ["💧"]);
  const drops = Array.from({ length: 80 }, () => ({ e: pick(set), x: rnd(0, W), y: -rnd(40, H * 1.1), v: rnd(500, 1050), s: rnd(34, 78), r: rnd(-3, 3), vr: rnd(-3, 3) }));
  const dur = 4;
  return (t, dt) => {
    const a = fadeOut(t, dur, 0.5);
    for (const d of drops) {
      d.y += d.v * dt;
      d.r += d.vr * dt;
      emoji(d.e, d.x, d.y - d.v * 0.035, d.s, d.r, a * 0.2);
      emoji(d.e, d.x, d.y - d.v * 0.018, d.s, d.r, a * 0.35);
      emoji(d.e, d.x, d.y, d.s, d.r, a);
    }
    caption(text, t, dur, { at: 0.3 });
    return t < dur;
  };
};

// An explosion of emoji and sparks from the middle of the screen.
EFFECTS.burst = (list, text) => {
  const set = splitEmoji(list, ["🎉", "🎊", "✨"]);
  const cx = W / 2, cy = H / 2;
  const bits = Array.from({ length: 64 }, () => {
    const a = rnd(0, TAU), sp = rnd(300, 1200);
    return { e: pick(set), x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 300, s: rnd(30, 70), r: 0, vr: rnd(-8, 8) };
  });
  const sparks = [];
  burstSparks(sparks, cx, cy, 120, { speed: [300, 1300], g: 600, life: [0.5, 1.2], tail: 3 });
  const dur = 3.2;
  return (t, dt) => {
    flash(t < 0.15 ? 0.25 * (1 - t / 0.15) : 0);
    shockwave(cx, cy, t, { dur: 0.7, r1: 600 });
    ctx.globalCompositeOperation = "lighter";
    glow(cx, cy, 300, "rgba(255,220,150,1)", 0.6 * (1 - clamp(t / 0.5)));
    ctx.globalCompositeOperation = "source-over";
    stepSparks(sparks, dt);
    for (const b of bits) {
      b.vx *= Math.pow(0.985, dt * 60);
      b.vy = b.vy * Math.pow(0.985, dt * 60) + 1300 * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.r += b.vr * dt;
      emoji(b.e, b.x, b.y, b.s, b.r, fadeOut(t, dur, 0.6));
    }
    caption(text, t, dur, { at: 0.2 });
    return t < dur;
  };
};

// Emoji float up from the bottom, swaying, with a sparkle trail.
EFFECTS.float = (list, text) => {
  const set = splitEmoji(list, ["🎈"]);
  const items = Array.from({ length: 40 }, () => ({ e: pick(set), x: rnd(0, W), y: H + rnd(40, H * 0.8), v: rnd(170, 400), s: rnd(36, 84), ph: rnd(0, TAU) }));
  const sparks = [];
  const dur = 5;
  return (t, dt) => {
    const a = fadeOut(t, dur, 0.8);
    for (const it of items) {
      it.y -= it.v * dt;
      const x = it.x + Math.sin(t * 2 + it.ph) * 40;
      if (Math.random() < 0.08) sparks.push(spark({ x: x + rnd(-10, 10), y: it.y + it.s * 0.4, vy: rnd(20, 80), g: 0, life: 0.7, size: 2, hue: rnd(0, 360), light: 80 }));
      emoji(it.e, x, it.y, it.s, Math.sin(t * 3 + it.ph) * 0.2, a);
    }
    stepSparks(sparks, dt);
    caption(text, t, dur, { at: 0.5 });
    return t < dur;
  };
};

// One emoji blasts off from the bottom on a column of fire and smoke.
EFFECTS.launch = (list, text) => {
  const e = pick(splitEmoji(list, ["🚀"]));
  const fire = [], sparks = [];
  const dur = 3.2;
  let popped = false;
  return (t, dt) => {
    const k = clamp(t / 2.2);
    const y = H + 120 - (H + 360) * Math.pow(k, 2.1);
    const shake = t < 0.5 ? Math.sin(t * 90) * 4 : 0;
    const x = W / 2 + shake + Math.sin(k * 8) * 20 * (1 - k);
    if (k < 1) {
      for (let i = 0; i < 10; i++) {
        fire.push(spark({ x: x + rnd(-14, 14), y: y + 80, vx: rnd(-60, 60), vy: rnd(200, 520), g: 0, drag: 0.94, life: rnd(0.3, 0.8), size: rnd(8, 18), hue: rnd(15, 50), light: 60 }));
      }
      if (Math.random() < 0.5) sparks.push(spark({ x, y: y + 80, vx: rnd(-200, 200), vy: rnd(100, 500), g: 900, life: 0.8, size: 2, hue: 45, twinkle: true }));
    } else if (!popped) {
      popped = true;
      burstSparks(sparks, W / 2, 80, 140, { speed: [200, 900], g: 400, tail: 6, life: [0.8, 1.6] });
    }
    // Smoke and fire, then the rocket on top.
    ctx.globalCompositeOperation = "lighter";
    for (let i = fire.length - 1; i >= 0; i--) {
      const p = fire[i];
      p.age += dt;
      if (p.age > p.life) { fire.splice(i, 1); continue; }
      p.vx *= 0.94; p.vy *= 0.94;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const q = p.age / p.life;
      glow(p.x, p.y, p.size * (1 + q * 2.5), hsl(p.hue - q * 30, 100, 65 - q * 25, 1), (1 - q) * 0.7);
    }
    ctx.globalCompositeOperation = "source-over";
    stepSparks(sparks, dt);
    if (k < 1) emoji(e, x, y, 160, -Math.PI / 4 + (e === "🚀" ? 0 : Math.PI / 4), 1);
    caption(text, t, dur, { at: 2.1, y: H * 0.3 });
    return t < dur || sparks.length > 0 || fire.length > 0;
  };
};

// Big glowing words wave across the middle of the screen.
EFFECTS.banner = (list, text) => {
  const e = pick(splitEmoji(list, ["✨"]));
  text = text || "Hello";
  const size = text.length > 40 ? 58 : text.length > 20 ? 76 : 104;
  ctx.font = `800 ${size}px ${FONT}`;
  const letters = [...text];
  const widths = letters.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + size * 3;
  // Slow enough to read: about 600 points a second.
  const dur = Math.max(3.2, (W + total) / 600);
  const hue0 = rnd(0, 360);
  return (t) => {
    const x0 = W - (W + total) * (t / dur);
    ctx.font = `800 ${size}px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    emoji(e, x0 + size * 0.6, H / 2, size * 1.1, Math.sin(t * 6) * 0.3);
    let x = x0 + size * 1.5;
    letters.forEach((c, i) => {
      const y = H / 2 + Math.sin(t * 6 - i * 0.45) * size * 0.12;
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = "rgba(10,10,20,0.7)";
      ctx.strokeText(c, x, y);
      ctx.fillStyle = hsl(hue0 + i * 9 + t * 60, 100, 70);
      ctx.fillText(c, x, y);
      x += widths[i];
    });
    emoji(e, x + size * 0.9, H / 2, size * 1.1, -Math.sin(t * 6) * 0.3);
    return t < dur;
  };
};

const EMOJI_MODES = new Set(["pop", "spin", "rain", "burst", "float", "launch", "banner"]);

listen("fx", ({ payload: { mode, args } }) => {
  const make = EFFECTS[mode];
  if (!make) return;
  const step = EMOJI_MODES.has(mode) ? make(args[0], args[1]) : make(args[0]);
  play(step);
});

// ---------- drawing ink ----------

// The ink you draw with: a glowing rainbow line with sparks flying off its tip.
// When you lift your finger it bursts (a match), shakes off (no match), or
// curls up into a gold seed (recorded in settings).
let ink = null;

function inkStep(stroke) {
  const sparks = [];
  stroke.tip = [];
  return (t, dt) => {
    const pts = stroke.pts;
    if (stroke.end && stroke.endT === undefined) stroke.endT = t;
    const since = stroke.endT === undefined ? 0 : t - stroke.endT;
    const end = stroke.end;
    if (end === "match" && !stroke.burst) {
      stroke.burst = true;
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = pts[i];
        burstSparks(sparks, x, y, 2, { hue: [stroke.hue0 + i * 2, stroke.hue0 + i * 2 + 30], speed: [80, 420], g: 0, drag: 0.94, life: [0.5, 1.1], size: [2, 3.5] });
      }
    }
    let alpha = 1, shake = 0, shrink = 0;
    if (end === "match") alpha = 1 - clamp(since / 0.25);
    if (end === "miss") { shake = Math.sin(since * 50) * 10 * (1 - clamp(since / 0.5)); alpha = 1 - clamp((since - 0.3) / 0.4); }
    if (end === "cancel") alpha = 1 - clamp(since / 0.25);
    if (end === "recorded") { shrink = easeIn(since / 0.6); alpha = 1 - clamp((since - 0.45) / 0.2); }
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x; cy += y; }
    cx /= pts.length || 1; cy /= pts.length || 1;
    const at = ([x, y]) => [x + (cx - x) * shrink + shake, y + (cy - y) * shrink];

    if (alpha > 0.01 && pts.length > 1) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.globalCompositeOperation = "lighter";
      const passes = [[26, 0.1, 55], [12, 0.28, 62], [4.5, 0.95, 78]];
      for (const [w, a, l] of passes) {
        ctx.lineWidth = w;
        // Short segments so the color can sweep along the line.
        for (let i = 1; i < pts.length; i++) {
          const hue = end === "miss" ? 0 : end === "recorded" ? 45 : stroke.hue0 + i * 2.2 + t * 90;
          const sat = end === "miss" ? 15 : 100;
          ctx.strokeStyle = hsl(hue, sat, end === "match" && since < 0.12 ? 95 : l, a * alpha);
          const [x0, y0] = at(pts[i - 1]), [x1, y1] = at(pts[i]);
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = "source-over";
      if (!end) {
        const [hx, hy] = pts[pts.length - 1];
        ctx.globalCompositeOperation = "lighter";
        glow(hx, hy, 34, hsl(stroke.hue0 + pts.length * 2.2 + t * 90, 100, 70, 1), 0.9);
        ctx.globalCompositeOperation = "source-over";
      }
    }
    stepSparks(sparks, dt);
    stepSparks(stroke.tip, dt);
    if (end === "match") {
      shockwave(cx, cy, since, { dur: 0.7, r1: 380, color: "255,255,255" });
      caption(stroke.name, since, 1.6, { y: cy, size: 64 });
    }
    if (end === "miss" && since > 0.1) {
      ctx.font = `600 22px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - clamp((since - 0.6) / 0.4))})`;
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = 8;
      ctx.fillText("Didn't recognize that one", cx, cy);
      ctx.shadowBlur = 0;
    }
    if (end === "recorded" && since > 0.4) {
      ctx.globalCompositeOperation = "lighter";
      glow(cx, cy, 40 * (1 + Math.sin(since * 12) * 0.2), "rgba(255,210,90,1)", 1 - clamp((since - 0.6) / 0.4));
      ctx.globalCompositeOperation = "source-over";
    }
    const done = end && since > (end === "match" ? 1.7 : end === "miss" ? 1.1 : 0.9) && !sparks.length && !stroke.tip.length;
    return !done;
  };
}

listen("ink", ({ payload: p }) => {
  const x = p.x * W, y = p.y * H;
  if (p.phase === "start") {
    if (ink && !ink.end) ink.end = "cancel";
    ink = { pts: [[x, y]], hue0: rnd(0, 360), end: null };
    play(inkStep(ink));
    return;
  }
  if (!ink) return;
  if (p.phase === "move") {
    if (!ink.end) {
      ink.pts.push([x, y]);
      // A few sparks peel off the tip as you draw.
      if (Math.random() < 0.6 && !reduced) {
        const hue = ink.hue0 + ink.pts.length * 2.2;
        burstSparks(ink.tip, x, y, 2, { hue: [hue, hue + 40], speed: [40, 160], g: 120, life: [0.3, 0.7], size: [1.5, 2.5] });
      }
    }
    return;
  }
  ink.end = p.phase; // match, miss, cancel, recorded
  ink.name = p.name;
  ink = null;
});
