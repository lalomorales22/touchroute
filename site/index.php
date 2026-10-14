<?php
// TouchRoute landing page. Drop this file on any PHP host.
$repo    = 'lalomorales22/touchroute';
$version = '0.1.0';
$dmg     = "https://github.com/$repo/releases/latest/download/TouchRoute.dmg";
$install = "curl -fsSL https://raw.githubusercontent.com/$repo/main/install.sh | bash";
$github  = "https://github.com/$repo";
$h = fn($s) => htmlspecialchars($s, ENT_QUOTES);
?><!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TouchRoute: hold your fingers down, run anything</title>
<meta name="description" content="Hold fingers on your trackpad for a few seconds and let go. TouchRoute opens apps, runs scripts, and starts Claude. Set it up by describing what you want.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@200..600&display=swap" rel="stylesheet">
<style>
  :root {
    --void: #000;
    --raised: rgba(255,255,255,.045);
    --line: rgba(255,255,255,.1);
    --text: #f2f1f7;
    --dim: #9897a6;
    --faint: #5c5b68;
    --display: "Geist", -apple-system, system-ui, sans-serif;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    color-scheme: dark;
  }
  * { box-sizing: border-box; }
  html { background: var(--void); }
  body { margin: 0; background: var(--void); color: var(--text); font: 17px/1.55 var(--sans); -webkit-font-smoothing: antialiased; }
  a { color: inherit; }
  :focus-visible { outline: 2px solid rgba(255,255,255,.6); outline-offset: 3px; border-radius: 6px; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

  nav { display: flex; align-items: center; justify-content: space-between; height: 72px; }
  .brand { display: flex; align-items: center; gap: 10px; font: 500 18px/1 var(--display); text-decoration: none; }
  .mark { position: relative; width: 24px; height: 17px; }
  .mark i { position: absolute; width: 6px; height: 6px; border-radius: 50%; }
  nav a.gh { color: var(--dim); text-decoration: none; font-size: 15px; }
  nav a.gh:hover { color: var(--text); }

  /* ---------- hero ---------- */
  .hero { display: grid; grid-template-columns: 1fr 1.05fr; gap: 56px; align-items: center; padding: 56px 0 96px; }
  h1 {
    font: 300 clamp(42px, 6vw, 78px)/1 var(--display); letter-spacing: -0.035em; margin: 0;
  }
  .hero p { color: var(--dim); font-size: 19px; max-width: 30em; margin: 24px 0 32px; }
  .cta { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
  .btn {
    display: inline-flex; align-items: center; gap: 10px; padding: 14px 22px; border-radius: 14px;
    font: 600 16px/1 var(--sans); text-decoration: none; border: 1px solid var(--line);
    background: none; color: var(--text); cursor: pointer;
  }
  .btn.main { background: #d6d9de; color: #000; border-color: transparent; }
  .btn.main:hover { background: #fff; }
  .btn.ghost:hover { background: var(--raised); }
  .soon-note { margin-top: 16px; font-size: 14px; color: var(--faint); }

  .stage { position: relative; aspect-ratio: 1.18; }
  .pad {
    position: absolute; inset: 6% 0 0 0; border-radius: 28px;
    background: linear-gradient(160deg, #15151b, #050507 70%);
    border: 1px solid var(--line);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.06), 0 40px 80px rgba(0,0,0,.6);
  }
  .pad canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 28px; }
  .term {
    position: absolute; right: -4%; bottom: -8%; width: 58%;
    background: #0d0d12; border: 1px solid var(--line); border-radius: 14px;
    box-shadow: 0 30px 60px rgba(0,0,0,.7);
    font: 14px/1.5 var(--mono); overflow: hidden;
    opacity: 0; transform: translateY(16px) scale(.97); transition: opacity .35s, transform .35s;
  }
  .term.show { opacity: 1; transform: none; }
  .term .bar { display: flex; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  .term .bar i { width: 10px; height: 10px; border-radius: 50%; background: #2a2a33; }
  .term pre { margin: 0; padding: 14px 16px 18px; min-height: 92px; white-space: pre-wrap; }
  .term .p { color: var(--faint); }
  .term .caret { display: inline-block; width: 8px; height: 1.1em; vertical-align: -2px; background: var(--text); animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }

  /* ---------- sections ---------- */
  section.band { padding: 96px 0; border-top: 1px solid var(--line); }
  h2 { font: 300 clamp(30px, 4vw, 48px)/1.05 var(--display); letter-spacing: -0.03em; margin: 0 0 16px; }
  .sub { color: var(--dim); max-width: 36em; margin: 0 0 48px; font-size: 18px; }

  .gridzone { display: grid; grid-template-columns: auto 1fr; gap: 56px; align-items: start; }
  .matrix { display: grid; grid-template-columns: 34px repeat(8, 34px); gap: 6px; }
  .matrix .h { font: 600 12px/34px var(--display); color: var(--faint); text-align: center; }
  .matrix .c { width: 34px; height: 34px; border-radius: 9px; background: var(--raised); border: 1px solid var(--line); position: relative; cursor: default; }
  .matrix .c.mac { background: rgba(255,255,255,.02); border-style: dashed; }
  .matrix .c.set::after { content: ""; position: absolute; inset: 11px; border-radius: 50%; background: var(--k); box-shadow: 0 0 12px var(--k); }
  .matrix .c:hover, .matrix .c.focus { border-color: var(--k); border-style: solid; }
  .readout { position: sticky; top: 24px; }
  .readout .code { font: 200 clamp(72px, 10vw, 128px)/0.9 var(--display); letter-spacing: -0.04em; transition: color .2s; }
  .readout .what { font-size: 20px; margin-top: 12px; min-height: 2.6em; }
  .readout .meta { color: var(--dim); font-size: 15px; }
  .legend { margin-top: 32px; display: grid; gap: 10px; color: var(--dim); font-size: 15px; }
  .legend b { color: var(--text); font-weight: 600; }

  .steps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; list-style: none; padding: 0; margin: 0; counter-reset: s; }
  .steps li { border: 1px solid var(--line); border-radius: 20px; padding: 28px; background: var(--raised); counter-increment: s; }
  .steps li::before { content: counter(s); font: 200 44px/1 var(--display); color: var(--faint); display: block; margin-bottom: 20px; }
  .steps h3 { font: 500 22px/1.15 var(--display); margin: 0 0 10px; letter-spacing: -0.01em; }
  .steps p { color: var(--dim); margin: 0; font-size: 16px; }
  .say { margin-top: 18px; font: 14px/1.45 var(--mono); background: #0b0b10; border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; color: var(--text); }

  .buddyzone { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  .buddydemo { display: flex; align-items: center; justify-content: center; min-height: 380px; }
  .bd { position: relative; width: 300px; height: 360px; }
  .bd canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .bd .shell {
    position: absolute; left: 66px; top: 96px; width: 168px; height: 168px; border-radius: 50%;
    background: radial-gradient(circle at 50% 38%, #17171f, #000 72%); border: 1px solid var(--line);
    transition: all .55s cubic-bezier(.2,.9,.2,1);
  }
  .bd.open .shell { left: 0; top: 0; width: 300px; height: 360px; border-radius: 22px; }
  .bd .rows { position: absolute; left: 22px; top: 22px; right: 22px; opacity: 0; transition: opacity .3s; font-size: 14px; }
  .bd.open .rows { opacity: 1; transition-delay: .25s; }
  .bd .rows strong { display: block; font: 500 16px/1 var(--display); margin-bottom: 16px; }
  .bd .row { display: grid; grid-template-columns: 20px 40px 1fr; height: 34px; align-items: center; }
  .bd .row span:nth-child(2) { font: 500 14px/1 var(--display); color: var(--dim); }
  .toggle { margin-top: 28px; }

  .install { display: grid; grid-template-columns: 1.3fr 1fr; gap: 20px; align-items: start; }
  .install > * { min-width: 0; }
  .card { border: 1px solid var(--line); border-radius: 20px; padding: 28px; background: var(--raised); }
  .card h3 { font: 500 22px/1.1 var(--display); margin: 0 0 8px; }
  .card p { color: var(--dim); margin: 0 0 18px; font-size: 16px; }
  .cmd { display: flex; align-items: center; gap: 10px; background: #000; border: 1px solid var(--line); border-radius: 12px; padding: 6px 6px 6px 16px; }
  .cmd code { flex: 1; min-width: 0; font: 13.5px/1.4 var(--mono); overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
  .cmd button { font: 600 13px/1 var(--sans); padding: 10px 14px; border-radius: 9px; border: 1px solid var(--line); background: var(--raised); color: var(--text); cursor: pointer; }
  .cmd button:hover { background: rgba(255,255,255,.1); }
  .card .after { margin-top: 18px; font-size: 14px; color: var(--faint); }
  .card.later { border-style: dashed; background: none; }
  .card.later ul { margin: 0; padding-left: 18px; color: var(--dim); font-size: 15px; }

  footer { border-top: 1px solid var(--line); padding: 32px 0 48px; color: var(--faint); font-size: 14px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; }

  @media (max-width: 880px) {
    .hero, .gridzone, .buddyzone, .install { grid-template-columns: 1fr; }
    .hero { padding-top: 24px; gap: 64px; }
    .steps { grid-template-columns: 1fr; }
    .term { right: 0; width: 72%; }
    .readout { position: static; }
    .matrix { grid-template-columns: 28px repeat(8, minmax(0, 34px)); gap: 5px; }
    .matrix .c { width: auto; aspect-ratio: 1; height: auto; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; }
  }
</style>
</head>
<body>
<div class="wrap">
  <nav>
    <a class="brand" href="#"><span class="mark" aria-hidden="true">
      <i style="left:0;top:10px;background:hsl(210 26% 76%)"></i><i style="left:4px;top:3px;background:hsl(186 24% 76%)"></i><i style="left:9px;top:0;background:hsl(150 18% 76%)"></i><i style="left:14px;top:3px;background:hsl(92 18% 76%)"></i><i style="left:18px;top:10px;background:hsl(42 32% 76%)"></i>
    </span>TouchRoute</a>
    <a class="gh" href="<?= $h($github) ?>">GitHub</a>
  </nav>

  <header class="hero">
    <div>
      <h1>Hold your fingers down. Let go. It runs.</h1>
      <p>TouchRoute turns your trackpad into a keyboard made of hands. Five fingers for five seconds opens Claude. Three fingers for four seconds starts your dev server. You pick the fingers and the seconds, and say what should happen.</p>
      <div class="cta">
        <a class="btn main" href="<?= $h($dmg) ?>">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4.1zM13.9 4.9c.7-.9 1.2-2 1.1-3.2-1 0-2.3.7-3 1.6-.7.8-1.2 2-1.1 3.1 1.2.1 2.3-.6 3-1.5z"/></svg>
          Download for Mac
        </a>
        <a class="btn ghost" href="#install">Install with one line</a>
      </div>
      <div class="soon-note">Version <?= $h($version) ?> for Apple silicon Macs on macOS 12 and later. Windows and Linux are on the way.</div>
    </div>
    <div class="stage" aria-label="Animation: five fingers land on a trackpad, a ring counts to five seconds, they lift, and a terminal opens running claude.">
      <div class="pad"><canvas id="pad"></canvas></div>
      <div class="term" id="term"><div class="bar"><i></i><i></i><i></i></div><pre id="termText"></pre></div>
    </div>
  </header>
</div>

<section class="band">
  <div class="wrap">
    <h2>Fingers times seconds.</h2>
    <p class="sub">Every combination is its own shortcut. Hover the grid to see what a few of them could do.</p>
    <div class="gridzone">
      <div class="matrix" id="matrix" role="img" aria-label="A grid of 10 finger counts by 8 seconds"></div>
      <div class="readout" aria-live="polite">
        <div class="code" id="rcode">5·5</div>
        <div class="what" id="rwhat">Open Terminal and start Claude</div>
        <div class="meta" id="rmeta">5 fingers, held 5 seconds</div>
        <div class="legend">
          <div><b>80 touches on a Mac.</b> Apple trackpads track all ten fingers.</div>
          <div><b>40 on Windows and Linux.</b> Their trackpads stop counting at five, so the dashed rows are Mac only.</div>
          <div><b>9 and 10 seconds</b> are coming soon, for the truly patient.</div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="band">
  <div class="wrap">
    <h2>Set up a touch in a minute.</h2>
    <p class="sub">No config files, no scripting required. If you already have .sh files, point a touch at them.</p>
    <ol class="steps">
      <li>
        <h3>Pick a square</h3>
        <p>Open settings and choose how many fingers and how many seconds.</p>
      </li>
      <li>
        <h3>Say what you want</h3>
        <p>Type it in plain words. Claude on your computer writes the script, and you read it before it's saved.</p>
        <div class="say">Start the dev server in ~/code/site and open localhost:3000</div>
      </li>
      <li>
        <h3>Hold and let go</h3>
        <p>Keep your fingers still while the ring fills to your number, then lift. Move them and nothing happens, so scrolling never sets it off.</p>
      </li>
    </ol>
  </div>
</section>

<section class="band">
  <div class="wrap buddyzone">
    <div>
      <h2>A little buddy that remembers for you.</h2>
      <p class="sub">TouchRoute lives in a small black window on your desktop: a cluster of dots that drift and breathe. Each colored dot is one of your touches. Zoom in and they line up into a list, so you never forget what 4·7 does.</p>
      <button class="btn ghost toggle" id="bdToggle" type="button">Zoom in</button>
    </div>
    <div class="buddydemo">
      <div class="bd" id="bd">
        <div class="shell"></div>
        <canvas id="bdc"></canvas>
        <div class="rows" id="bdrows"><strong>Your touches</strong></div>
      </div>
    </div>
  </div>
</section>

<section class="band" id="install">
  <div class="wrap">
    <h2>Install</h2>
    <p class="sub">Download the app, or paste one line into Terminal. It installs TouchRoute into Applications and opens it.</p>
    <div class="install">
      <div class="card">
        <h3>macOS</h3>
        <p>Works with the built-in trackpad and the Magic Trackpad.</p>
        <div class="cmd"><code id="cmd"><?= $h($install) ?></code><button type="button" id="copy">Copy</button></div>
        <div class="after">To write touches with AI, install <a href="https://claude.com/claude-code">Claude Code</a> too. Without it you can still use quick starts or your own scripts.</div>
      </div>
      <div class="card later">
        <h3>Windows and Linux</h3>
        <p>Coming soon, with up to 5 fingers.</p>
        <ul>
          <li>Windows uses Precision Touchpad input.</li>
          <li>Linux reads multitouch through evdev.</li>
        </ul>
      </div>
    </div>
  </div>
</section>

<div class="wrap">
  <footer>
    <span>TouchRoute <?= $h($version) ?></span>
    <a href="<?= $h($github) ?>">Source on GitHub</a>
  </footer>
</div>

<script>
// The same muted finger tones as the app: steel, teal, sage, olive, sand, clay...
const TONES = [[210, 26], [186, 24], [150, 18], [92, 18], [42, 32], [22, 32], [6, 26], [220, 6], [32, 14], [200, 10]];
const col = (f, a = 1, l = 76) => { const [h, s] = TONES[(f - 1) % 10]; return `hsla(${h}, ${s}%, ${l}%, ${a})`; };
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function fit(canvas) {
  const dpr = devicePixelRatio || 1, r = canvas.getBoundingClientRect();
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

// ---------- hero: five fingers, five seconds, claude ----------
(() => {
  const canvas = document.getElementById("pad"), term = document.getElementById("term"), text = document.getElementById("termText");
  let g = fit(canvas); addEventListener("resize", () => (g = fit(canvas)));
  const tips = [[.30, .58], [.40, .36], [.53, .30], [.65, .36], [.73, .62]];
  const LAND = 1.4, HOLD = 5, CYCLE = 11.5;
  const start = performance.now();
  let typed = -1;
  function frame(now) {
    const t = reduced ? LAND + 0.8 * 5 + 5.2 : ((now - start) / 1000) % CYCLE;
    const { ctx, w, h } = g;
    ctx.clearRect(0, 0, w, h);
    const held = Math.max(0, t - LAND);
    const lifted = held > HOLD + 0.15;
    const cx = w * .52, cy = h * .5, R = Math.min(w, h) * .36;
    // ring of seconds
    for (let i = 0; i < 8; i++) {
      const seg = Math.PI * 2 / 8, a0 = -Math.PI / 2 + i * seg + .06, a1 = a0 + seg - .12;
      ctx.lineCap = "round"; ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(255,255,255,.06)"; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
      const fill = lifted ? (i < 5 ? 1 : 0) : Math.max(0, Math.min(1, held - i));
      if (fill > 0 && t > LAND) {
        const fade = lifted ? Math.max(0, 1 - (held - HOLD) / 2) : 1;
        ctx.strokeStyle = col(5, fade); ctx.shadowColor = col(5, .8 * fade); ctx.shadowBlur = 14;
        ctx.beginPath(); ctx.arc(cx, cy, R, a0, a0 + (a1 - a0) * fill); ctx.stroke(); ctx.shadowBlur = 0;
      }
    }
    // fingertips
    tips.forEach(([x, y], i) => {
      const land = i * .22;
      if (t < land || lifted) return;
      const k = Math.min(1, (t - land) / .25);
      const px = x * w, py = y * h, r = Math.min(w, h) * .055 * (1.25 - .25 * k);
      const grd = ctx.createRadialGradient(px, py, 0, px, py, r * 2.4);
      grd.addColorStop(0, col(i * 2 + 1, .35 * k)); grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(px, py, r * 2.4, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${.9 * k})`; ctx.beginPath(); ctx.arc(px, py, r * .55, 0, 7); ctx.fill();
    });
    // count
    const n = lifted ? 5 : Math.min(5, Math.floor(held));
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `200 ${Math.round(R * .62)}px "Geist", sans-serif`;
    ctx.fillStyle = t < LAND ? "rgba(255,255,255,.12)" : lifted ? col(5) : "#f2f1f7";
    ctx.fillText(t < LAND ? "·" : `5·${Math.max(n, 0)}`, cx, cy + R * .78);
    // terminal
    const termOn = lifted && held < HOLD + 5;
    term.classList.toggle("show", termOn);
    const chars = termOn ? Math.min(6, Math.floor((held - HOLD - .6) * 9)) : -1;
    if (chars !== typed) {
      typed = chars;
      const typedTxt = "claude".slice(0, Math.max(0, chars));
      const reply = chars >= 6 && held > HOLD + 2.2 ? "\n\n✻ Welcome back. What are we building?" : "";
      text.innerHTML = `<span class="p">~ %</span> ${typedTxt}${reply ? "" : '<span class="caret"></span>'}${reply}`;
    }
    if (!reduced) requestAnimationFrame(frame);
  }
  document.fonts.ready.then(() => requestAnimationFrame(frame));
})();

// ---------- the grid ----------
(() => {
  const examples = {
    "5-5": "Open Terminal and start Claude", "3-4": "Start the dev server and open localhost", "2-2": "Play Spotify",
    "4-7": "Launch three Claude agents, one per project", "1-3": "Mute the microphone", "3-1": "Lock the screen",
    "2-5": "Take a screenshot of an area", "7-3": "Deploy the website", "10-8": "Run the whole morning routine",
    "6-2": "Open every work app at once",
  };
  const m = document.getElementById("matrix");
  const rcode = document.getElementById("rcode"), rwhat = document.getElementById("rwhat"), rmeta = document.getElementById("rmeta");
  m.innerHTML = '<div class="h"></div>' + Array.from({ length: 8 }, (_, i) => `<div class="h">${i + 1}s</div>`).join("");
  for (let f = 1; f <= 10; f++) {
    m.insertAdjacentHTML("beforeend", `<div class="h" style="color:${col(f)}">${f}</div>`);
    for (let s = 1; s <= 8; s++) {
      const key = `${f}-${s}`;
      const c = document.createElement("div");
      c.className = "c" + (f > 5 ? " mac" : "") + (examples[key] ? " set" : "");
      c.style.setProperty("--k", col(f));
      c.addEventListener("mouseenter", () => show(f, s));
      m.appendChild(c);
    }
  }
  function show(f, s) {
    rcode.textContent = `${f}·${s}`; rcode.style.color = col(f);
    rwhat.textContent = examples[`${f}-${s}`] ?? "Anything you want";
    rmeta.textContent = `${f} finger${f > 1 ? "s" : ""}, held ${s} second${s > 1 ? "s" : ""}${f > 5 ? ", Mac only" : ""}`;
  }
  show(5, 5);
})();

// ---------- the buddy ----------
(() => {
  const bd = document.getElementById("bd"), canvas = document.getElementById("bdc"), rows = document.getElementById("bdrows");
  const items = [[2, 2, "Play Spotify"], [3, 1, "Lock the screen"], [3, 4, "Start dev server"], [4, 7, "Launch 3 agents"], [5, 5, "Talk to Claude"], [7, 3, "Deploy the site"]];
  items.forEach(([f, s, n]) => rows.insertAdjacentHTML("beforeend", `<div class="row"><span class="pin"></span><span>${f}·${s}</span><span>${n}</span></div>`));
  let g = fit(canvas); addEventListener("resize", () => (g = fit(canvas)));
  const dots = [...items.map(([f], i) => ({ f, i })), ...Array.from({ length: 14 }, (_, i) => ({ f: 0, i: i + items.length }))]
    .map((d) => ({ ...d, a: d.i * 2.4, o: 14 + Math.sqrt(d.i + 1) * 9.5, sp: (.2 + Math.random() * .2) * (Math.random() < .5 ? -1 : 1), seed: Math.random() * 99, x: 150, y: 180, al: 1 }));
  let open = false;
  document.getElementById("bdToggle").onclick = (e) => {
    open = !open; bd.classList.toggle("open", open); e.target.textContent = open ? "Zoom out" : "Zoom in";
  };
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(.05, (now - last) / 1000); last = now; const t = now / 1000;
    const { ctx, w, h } = g; ctx.clearRect(0, 0, w, h);
    const pins = [...rows.querySelectorAll(".pin")].map((p) => { const r = p.getBoundingClientRect(), c = canvas.getBoundingClientRect(); return { x: r.left - c.left + 5, y: r.top - c.top + r.height / 2 }; });
    const ease = 1 - Math.exp(-dt * 7);
    for (const d of dots) {
      let tx, ty, ta;
      if (open && d.f) { ({ x: tx, y: ty } = pins[d.i]); ta = 1; }
      else {
        d.a += d.sp * dt;
        const r = d.o * (1 + Math.sin(t * 1.3) * .05) + (reduced ? 0 : Math.sin(t * 1.9 + d.seed) * 3.2);
        tx = 150 + Math.cos(d.a) * r; ty = 180 + Math.sin(d.a) * r * .86; ta = open ? 0 : d.f ? 1 : .5;
      }
      d.x += (tx - d.x) * ease; d.y += (ty - d.y) * ease; d.al += (ta - d.al) * ease;
      if (d.al < .02) continue;
      ctx.fillStyle = d.f ? col(d.f, d.al) : `rgba(222,225,230,${d.al * .6})`;
      ctx.shadowColor = d.f ? col(d.f, .9) : "transparent"; ctx.shadowBlur = d.f ? 10 : 0;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.f ? 4.6 : 1.8, 0, 7); ctx.fill();
    }
    ctx.shadowBlur = 0;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

document.getElementById("copy").onclick = async (e) => {
  try { await navigator.clipboard.writeText(document.getElementById("cmd").textContent); e.target.textContent = "Copied"; }
  catch { e.target.textContent = "Select and copy"; }
  setTimeout(() => (e.target.textContent = "Copy"), 1600);
};
</script>
</body>
</html>
