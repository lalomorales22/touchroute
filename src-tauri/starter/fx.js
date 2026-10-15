// TouchRoute rewrites this file every time it starts, so it stays in step
// with the app. To change an effect, copy it somewhere else and point your
// script at the copy.
//
// TouchRoute fun effects: draws emoji and text on a see-through layer over
// the screen, animates them for a few seconds, then disappears. Clicks pass
// straight through it, so it never gets in the way.
//
//   osascript -l JavaScript fx.js MODE "EMOJI EMOJI ..." ["TEXT"]
//
// MODE: pop, spin, rain, burst, fireworks, float, launch, banner
ObjC.import("Cocoa");

function run(argv) {
  const mode = argv[0] || "pop";
  const emojis = (argv[1] || "🎉").split(" ").filter(Boolean);
  const text = argv[2] || "";

  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1); // no Dock icon

  const screen = $.NSScreen.mainScreen.frame;
  const W = screen.size.width, H = screen.size.height;
  const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(screen, 0, 2, false);
  win.setOpaque(false);
  win.setBackgroundColor($.NSColor.clearColor);
  win.setLevel(1000);
  win.setIgnoresMouseEvents(true);
  win.setHasShadow(false);
  win.setCollectionBehavior(1 | 16 | 256); // every Space, even full screen
  win.orderFrontRegardless;
  const view = win.contentView;

  const pick = () => emojis[Math.floor(Math.random() * emojis.length)];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function label(str, size, color) {
    const f = $.NSTextField.labelWithString($(str));
    f.setFont(color ? $.NSFont.boldSystemFontOfSize(size) : $.NSFont.systemFontOfSize(size));
    if (color) f.setTextColor(color);
    f.sizeToFit;
    view.addSubview(f);
    return f;
  }
  function place(f, x, y, rot, alpha) {
    const s = f.frame.size;
    f.setFrameOrigin($.NSMakePoint(x - s.width / 2, y - s.height / 2));
    if (rot !== undefined) f.setFrameCenterRotation(rot);
    if (alpha !== undefined) f.setAlphaValue(alpha);
  }
  function animate(seconds, step) {
    const start = Date.now();
    for (;;) {
      const t = (Date.now() - start) / 1000;
      if (t > seconds) break;
      step(t, t / seconds);
      win.displayIfNeeded;
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(1 / 60));
    }
  }
  const fadeOut = (p, from = 0.8) => (p < from ? 1 : 1 - (p - from) / (1 - from));
  const easeBack = (p) => { const c = 1.7; p -= 1; return 1 + (c + 1) * p * p * p + c * p * p; };

  if (mode === "pop" || mode === "spin") {
    // One big emoji bounces in at the centre, then fades away.
    const e = pick();
    const f = label(e, 40);
    const cap = text ? label(text, 44, $.NSColor.whiteColor) : null;
    if (cap) { cap.setWantsLayer(true); cap.setShadow(shadow()); }
    animate(2.2, (t, p) => {
      const grow = Math.min(1, t / 0.45);
      const size = 40 + 200 * easeBack(grow);
      f.setFont($.NSFont.systemFontOfSize(size));
      f.sizeToFit;
      const rot = mode === "spin" ? t * 540 : Math.sin(t * 6) * 8 * (1 - p);
      place(f, W / 2, H / 2 + 40, rot, fadeOut(p, 0.75));
      if (cap) place(cap, W / 2, H / 2 - 140, 0, Math.min(1, t * 3) * fadeOut(p, 0.75));
    });
  } else if (mode === "rain") {
    // Lots of emoji fall from the top of the screen.
    const drops = Array.from({ length: 70 }, () => ({
      f: label(pick(), rnd(30, 70)), x: rnd(0, W), y: H + rnd(0, H * 0.9),
      v: rnd(500, 1000), r: rnd(-180, 180), vr: rnd(-200, 200),
    }));
    let last = 0;
    animate(3.6, (t, p) => {
      const dt = t - last; last = t;
      for (const d of drops) {
        d.y -= d.v * dt; d.r += d.vr * dt;
        place(d.f, d.x, d.y, d.r, fadeOut(p, 0.85));
      }
    });
  } else if (mode === "burst" || mode === "fireworks") {
    // Emoji explode out of a point and fall with gravity, like confetti.
    const bursts = mode === "fireworks"
      ? [[0.3, 0.6, 0], [0.7, 0.65, 0.5], [0.5, 0.75, 1.0], [0.2, 0.7, 1.5], [0.8, 0.55, 1.9]]
      : [[0.5, 0.5, 0]];
    const parts = [];
    for (const [bx, by, at] of bursts) {
      for (let i = 0; i < (mode === "fireworks" ? 26 : 60); i++) {
        const a = rnd(0, Math.PI * 2), sp = rnd(250, 900);
        const f = label(pick(), rnd(24, 54));
        f.setAlphaValue(0);
        parts.push({ f, at, x: bx * W, y: by * H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + 300, r: 0, vr: rnd(-400, 400) });
      }
    }
    let last = 0;
    animate(mode === "fireworks" ? 4 : 3, (t, p) => {
      const dt = t - last; last = t;
      for (const q of parts) {
        if (t < q.at) continue;
        q.vy -= 1100 * dt; q.vx *= 0.99;
        q.x += q.vx * dt; q.y += q.vy * dt; q.r += q.vr * dt;
        const age = t - q.at;
        place(q.f, q.x, q.y, q.r, Math.max(0, 1 - age / 2.2) * fadeOut(p, 0.9));
      }
    });
  } else if (mode === "float") {
    // Emoji drift up from the bottom, swaying side to side.
    const bubbles = Array.from({ length: 40 }, () => ({
      f: label(pick(), rnd(30, 80)), x: rnd(0, W), y: -rnd(40, H * 0.8),
      v: rnd(180, 420), sway: rnd(20, 70), ph: rnd(0, 6),
    }));
    let last = 0;
    animate(4.5, (t, p) => {
      const dt = t - last; last = t;
      for (const b of bubbles) {
        b.y += b.v * dt;
        place(b.f, b.x + Math.sin(t * 2 + b.ph) * b.sway, b.y, Math.sin(t * 3 + b.ph) * 12, fadeOut(p, 0.8));
      }
    });
  } else if (mode === "launch") {
    // A single emoji shoots up from the bottom with a trail behind it.
    const f = label(pick(), 150);
    const trail = Array.from({ length: 14 }, () => label("✨", rnd(24, 44)));
    animate(2.4, (t, p) => {
      const y = -150 + (H + 400) * Math.pow(p, 2.2);
      const x = W / 2 + Math.sin(p * 9) * 30 * (1 - p);
      place(f, x, y, 0, 1);
      trail.forEach((s, i) => place(s, x + rnd(-40, 40), y - 110 - i * 38, rnd(-30, 30), Math.max(0, 1 - i / 14)));
    });
  } else if (mode === "banner") {
    // Big text slides across the middle of the screen with emoji on each side.
    const e = pick();
    const f = label(`${e}  ${text}  ${e}`, text.length > 30 ? 64 : 96, $.NSColor.whiteColor);
    f.setShadow(shadow());
    const w = f.frame.size.width;
    // Slow enough to read: about 700 points a second, never under 3 seconds.
    animate(Math.max(3, (W + w) / 700), (t, p) => {
      place(f, W + w / 2 - (W + w) * p, H / 2, Math.sin(t * 5) * 3, 1);
    });
  }

  win.close;
}

function shadow() {
  const s = $.NSShadow.alloc.init;
  s.setShadowColor($.NSColor.colorWithCalibratedWhiteAlpha(0, 0.85));
  s.setShadowBlurRadius(12);
  s.setShadowOffset($.NSMakeSize(0, -3));
  return s;
}
