// ─── Canvas setup ──────────────────────────────────────────────────────────────
// Canvas is capped at 1920×1080 so it always matches the SVG/bg coordinate space.
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
let W = canvas.width = Math.min(window.innerWidth, 1920);
let H = canvas.height = Math.min(window.innerHeight, 1080);


// ─── Params ────────────────────────────────────────────────────────────────────
// Tweak these to change the feel of the simulation.
const P = {
  count:  6000,   // total number of particles (spread across all segments)
  speed:  0.65,   // base speed multiplier for particles
  fade:   0.35,   // trail fade per frame — higher = shorter trails (0.02 long … 0.60 short)
  spread: 20,     // spawn radius in pixels around the path start point
  size:   0.7,    // base particle radius multiplier
  noise:  0.55,   // how much random angle is added to the flow field each frame
  paused: false,  // start paused or playing
  trails: true,   // enable trail effect
};


// ─── Background image ──────────────────────────────────────────────────────────
// The bg image must be 1920×1080 to align with the SVG coordinate space.
const bgImg = new Image();
bgImg.src = './MAPA_BASE.png';

function drawBg() {
  if (!bgImg.complete || !bgImg.naturalWidth) return;
  ctx.drawImage(bgImg, 0, 0, W, H);
}


// ─── Coordinate conversion ─────────────────────────────────────────────────────
// SVG paths are parsed and normalised to 0–1 (divided by the SVG viewBox size).
// n2w converts them back to canvas pixels. Because both the SVG and the bg image
// are 1920×1080, the mapping is simply a proportional scale to canvas size.
let segments = [];

function n2w(nx, ny) {
  return [nx * W, ny * H];
}

// Returns a point slightly beyond the last point of segment s, in the direction
// the path was travelling. Particles that reach this point are considered "done"
// and get respawned at the start.
function getEndPt(s) {
  if (!segments[s]) return null;
  const seg = segments[s];
  const a = seg[Math.max(0, seg.length - 6)];
  const b = seg[seg.length - 1];
  const [ax, ay] = n2w(a.x, a.y);
  const [bx, by] = n2w(b.x, b.y);
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const OVERSHOOT = 35; // px past the path tip before respawn triggers
  return { x: bx + dx / len * OVERSHOOT, y: by + dy / len * OVERSHOOT };
}


// ─── Flow field ────────────────────────────────────────────────────────────────
// The canvas is divided into a COLS×ROWS grid. Each cell stores a single angle
// (in radians) that tells particles which direction to accelerate.
//
// For each cell we find the nearest point on the path, then blend two forces:
//   • tangent  — the direction the path is travelling at that nearest point
//   • attraction — the vector pointing from the cell toward that nearest point
//
// Far from the path (> PULL_PX px) the tangent dominates → particles flow parallel.
// Close to the path the attraction dominates → particles get pulled onto the line.
// This gives the "ink following a line" look.

const COLS = 200, ROWS = 130;
let fields = [];        // one Float32Array per segment, indexed [row * COLS + col]
const PULL_PX = 60;     // distance (px) at which attraction starts dominating
const END_REACH = 8;    // distance (px) to the endpoint that counts as "arrived"

function buildField() {
  // Convert all segments from normalised 0–1 to canvas pixels once up front.
  const segsPx = segments.map(seg =>
    seg.map(pt => { const [wx, wy] = n2w(pt.x, pt.y); return { x: wx, y: wy }; })
  );

  fields = segsPx.map(segPx => {
    const f = new Float32Array(COLS * ROWS);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        // Centre of this grid cell in canvas pixels.
        const cx = ((col + 0.5) / COLS) * W;
        const cy = ((row + 0.5) / ROWS) * H;

        // Find the nearest path point to this cell centre.
        let minD = 1e9, idx = 0;
        for (let i = 0; i < segPx.length; i++) {
          const dx = segPx[i].x - cx, dy = segPx[i].y - cy, d = dx * dx + dy * dy;
          if (d < minD) { minD = d; idx = i; }
        }
        minD = Math.sqrt(minD);

        // Tangent: direction the path is travelling at the nearest point.
        // Sampled over a small window (±6 points) to smooth it out.
        const i0 = Math.max(0, idx - 6), i1 = Math.min(segPx.length - 1, idx + 6);
        let tx = segPx[i1].x - segPx[i0].x, ty = segPx[i1].y - segPx[i0].y;
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;

        // Attraction: normalised vector from cell centre toward the nearest point.
        const ax = segPx[idx].x - cx, ay = segPx[idx].y - cy;
        const aLen = Math.hypot(ax, ay) || 1;

        // Blend: pull=0 far away (pure tangent), pull=1 close (pure attraction).
        const pull = Math.min(1, minD / PULL_PX);
        f[row * COLS + col] = Math.atan2(
          ty * (1 - pull) + (ay / aLen) * pull,
          tx * (1 - pull) + (ax / aLen) * pull
        );
      }
    }
    return f;
  });
}


// ─── Particle arrays ───────────────────────────────────────────────────────────
// All particle data is stored in flat typed arrays for performance.
// Index i refers to the same particle across all arrays.

const MAX = 6000;
const px   = new Float32Array(MAX); // position x (canvas px)
const py   = new Float32Array(MAX); // position y (canvas px)
const pvx  = new Float32Array(MAX); // velocity x
const pvy  = new Float32Array(MAX); // velocity y
const pspd = new Float32Array(MAX); // max speed cap (varies per particle for organic feel)
const psz  = new Float32Array(MAX); // radius (varies per particle)
const pwait = new Float32Array(MAX); // countdown before this particle starts moving (staggered reveal)
const pseg  = new Int16Array(MAX);  // which segment index this particle belongs to

let segActive     = []; // bool per segment — true once triggerSegment() has been called
let segDelays     = []; // per-segment delay in seconds (read from DELAYS config)
let segScene      = []; // maps segment index → source SVG filename (for color lookup)
let segPendingTick = []; // frame tick at which a delayed segment should auto-trigger (-1 = not pending)
let allTriggered  = false; // true after the first triggerAll() call this run


// ─── Config variables ──────────────────────────────────────────────────────────

// How many seconds to wait before each segment starts, by segment index.
// Segments beyond this array's length default to 0 (immediate).
const DELAYS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// Particle color keyed by source SVG filename.
const COLORS = {
  'Pacifico.svg':    '#ff1f1f',
  'Continental.svg': '#ffdd00',
  'Costeiro.svg':    '#40c8ff',
};


// ─── Particle spawn ────────────────────────────────────────────────────────────

// Resets a single particle to the start of its assigned segment with randomised
// speed and size. Called on first spawn and whenever a particle completes the path.
function spawnOne(i) {
  if (segments.length) {
    const seg = segments[pseg[i]] || segments[0];
    const [wx, wy] = n2w(seg[0].x, seg[0].y);
    // Scatter within a small disc around the path start point.
    const a = Math.random() * Math.PI * 2;
    const r = P.spread * 0.3 * Math.sqrt(Math.random()); // sqrt gives uniform disc distribution
    px[i] = wx + Math.cos(a) * r;
    py[i] = wy + Math.sin(a) * r;
  } else {
    // Fallback before any SVG is loaded.
    px[i] = Math.random() * W;
    py[i] = Math.random() * H;
  }
  pvx[i] = 0; pvy[i] = 0;
  pspd[i] = (0.5 + Math.random() * 2.2) * P.speed; // randomised speed cap
  psz[i]  = (0.3 + Math.random() * 1.6) * P.size;  // randomised size
}

// Activates a segment and staggers the reveal of its particles over ~4 seconds.
// Without staggering, all particles would start at the same spot and clump together.
function triggerSegment(s) {
  segActive[s] = true;
  const active = Math.min(P.count, MAX);
  // Total stagger window in 60-tick units (speed-scaled so fast speeds reveal quicker).
  const staggerFrames = 240 / Math.max(0.2, P.speed);

  // Count how many particles belong to this segment so we can distribute wait times.
  let segCount = 0;
  for (let i = 0; i < active; i++) { if (pseg[i] === s) segCount++; }

  let k = 0;
  for (let i = 0; i < active; i++) {
    if (pseg[i] === s) {
      spawnOne(i);
      pvx[i] = 0; pvy[i] = 0;
      // Each particle gets a linearly-spaced wait so they spread out along the path.
      pwait[i] = Math.floor((k / Math.max(1, segCount)) * staggerFrames);
      k++;
    }
  }
}

// Triggers all segments, respecting per-segment delays from the DELAYS config.
function triggerAll() {
  allTriggered = true;
  const base = tick;
  segments.forEach((_, s) => {
    const delayTicks = Math.round((segDelays[s] || 0) * 60); // seconds → frames (60fps)
    if (delayTicks === 0) {
      triggerSegment(s);
    } else {
      segPendingTick[s] = base + delayTicks; // fire later in the main loop
    }
  });
}

// Resets all particles and segment state without reloading the SVG.
function doReset() {
  allTriggered = false;
  segActive = segments.map(() => false);
  segPendingTick = new Array(segments.length).fill(-1);
  for (let i = 0; i < MAX; i++) { pvx[i] = 0; pvy[i] = 0; pwait[i] = 0; }
  ctx.clearRect(0, 0, W, H);
  trailCtx.clearRect(0, 0, W, H);
}


// ─── Color helpers ─────────────────────────────────────────────────────────────

function getSegColor(segIdx) {
  return COLORS[segScene[segIdx]] || COLORS['Pacifico.svg'];
}

// Returns an rgba string for a particle. lr (life ratio 0–1) controls opacity:
// particles near the endpoint fade out smoothly before respawning.
function particleColor(lr, segIdx) {
  const hex = getSegColor(segIdx);
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.pow(lr, 0.45) * 0.9; // power curve keeps high opacity longer, then drops fast
  return `rgba(${r},${g},${b},${a})`;
}


// ─── Trail buffer ──────────────────────────────────────────────────────────────
// Particles are drawn onto a separate off-screen canvas (trailCanvas) rather than
// directly onto the main canvas. Each frame, trailCanvas is partially erased using
// 'destination-out' blending, which reduces pixel alpha without touching the
// background — so the bg image never bleeds into the trails.
//
// Composite order each frame:
//   1. Fill main canvas black
//   2. Draw background image
//   3. Draw trailCanvas on top (contains faded particle history)
//   4. Draw overlays (spawn point markers)

const trailCanvas = document.createElement('canvas');
trailCanvas.width = W; trailCanvas.height = H;
const trailCtx = trailCanvas.getContext('2d');

let tick = 0;      // advances at 60 units/second regardless of framerate
let lastTime = 0;  // timestamp of previous frame, used to compute dt


// ─── Spawn point markers ───────────────────────────────────────────────────────
// Draws a small outlined circle + underline at the start of each path.
function drawSpawnPoints() {
  if (!segments.length) return;
  ctx.save();
  segments.forEach((seg, s) => {
    const [wx, wy] = n2w(seg[0].x, seg[0].y);
    ctx.strokeStyle = getSegColor(s);
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(wx, wy, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(wx - 5, wy + 8);
    ctx.lineTo(wx + 5, wy + 8);
    ctx.stroke();
  });
  ctx.restore();
}


// ─── Main loop ─────────────────────────────────────────────────────────────────
const DAMPING = 0.86; // velocity decay per frame at 60fps — lower = more drag, smoother curves
const FORCE   = 0.55; // flow field acceleration per frame at 60fps

function loop(timestamp) {
  // dt: seconds since last frame, capped at 0.1s to avoid huge jumps after tab switches.
  // dtScale: normalises physics to 60fps-equivalent so speed is consistent on any monitor.
  //   60hz  → dtScale ≈ 1.0   (one 60-tick unit per frame)
  //   120hz → dtScale ≈ 0.5   (half a unit per frame, twice as many frames → same result)
  const dt = lastTime ? Math.min((timestamp - lastTime) / 1000, 0.1) : 1 / 60;
  lastTime = timestamp;
  const dtScale = dt * 60;

  tick += dtScale;

  if (!P.paused) {
    // — Fade the trail buffer —
    // 'destination-out' erases pixels proportionally to globalAlpha.
    // A higher P.fade value erases more each frame → shorter trails.
    if (P.trails) {
      trailCtx.globalCompositeOperation = 'destination-out';
      trailCtx.globalAlpha = P.fade;
      trailCtx.fillRect(0, 0, W, H);
      trailCtx.globalCompositeOperation = 'source-over';
      trailCtx.globalAlpha = 1;
    } else {
      trailCtx.clearRect(0, 0, W, H);
    }

    // — Fire delayed segments —
    for (let s = 0; s < segments.length; s++) {
      if (segPendingTick[s] >= 0 && tick >= segPendingTick[s]) {
        segPendingTick[s] = -1;
        triggerSegment(s);
      }
    }

    // — Update and draw each particle —
    const active = Math.min(P.count, MAX);
    for (let i = 0; i < active; i++) {
      // Staggered reveal: count down wait time before this particle starts.
      if (pwait[i] > 0) { pwait[i] -= dtScale; continue; }
      // Skip particles whose segment hasn't been triggered yet.
      if (!segActive[pseg[i]]) continue;

      // Look up the flow field angle for this particle's current grid cell.
      const c = Math.floor(px[i] / W * COLS); // column index
      const r = Math.floor(py[i] / H * ROWS); // row index
      const f = fields[pseg[i]];
      if (f && c >= 0 && c < COLS && r >= 0 && r < ROWS) {
        // Add a small random offset to the field angle for organic variation.
        const angle = f[r * COLS + c] + (Math.random() - 0.5) * P.noise * 2;
        pvx[i] += Math.cos(angle) * FORCE * dtScale;
        pvy[i] += Math.sin(angle) * FORCE * dtScale;
      }

      // Apply drag (exponential decay so it's framerate-independent) and clamp to speed cap.
      const decay = Math.pow(DAMPING, dtScale);
      pvx[i] *= decay; pvy[i] *= decay;
      const spd = Math.hypot(pvx[i], pvy[i]), cap = pspd[i];
      if (spd > cap) { pvx[i] = pvx[i] / spd * cap; pvy[i] = pvy[i] / spd * cap; }

      px[i] += pvx[i] * dtScale; py[i] += pvy[i] * dtScale;

      // Respawn if the particle reached the endpoint or flew off-screen.
      const ep = getEndPt(pseg[i]);
      const dEnd = ep ? Math.hypot(px[i] - ep.x, py[i] - ep.y) : 999;
      if (dEnd < END_REACH) { spawnOne(i); pvx[i] = 0; pvy[i] = 0; continue; }
      if (px[i] < -100 || px[i] > W + 100 || py[i] < -100 || py[i] > H + 100) {
        spawnOne(i); pvx[i] = 0; pvy[i] = 0; continue;
      }

      // Fade out as the particle approaches the endpoint (avoids hard pop on respawn).
      const lr = Math.min(1, dEnd / 80);
      trailCtx.beginPath();
      trailCtx.arc(px[i], py[i], psz[i] * P.size, 0, Math.PI * 2);
      trailCtx.fillStyle = particleColor(lr, pseg[i]);
      trailCtx.fill();
    }

    // — Composite onto main canvas —
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    drawBg();
    ctx.drawImage(trailCanvas, 0, 0);
    drawSpawnPoints();

  } else if (segments.length) {
    // Paused: redraw the last trail frame without updating particles.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    drawBg();
    ctx.drawImage(trailCanvas, 0, 0);
    drawSpawnPoints();
  }

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);


// ─── SVG loading ───────────────────────────────────────────────────────────────

let currentScene = 'Pacifico.svg';

function loadSVGFromUrl(url) {
  fetch(url)
    .then(r => { if (!r.ok) throw new Error('not found'); return r.text(); })
    .then(txt => { currentScene = url; loadSVG(txt); })
    .catch(() => { });
}

// Parses an SVG string into an array of segments.
// Each segment is an array of {x, y} points normalised to 0–1 using the viewBox size.
// The SVG is temporarily inserted into the DOM so the browser can compute path lengths.
function parseSVGText(svgText) {
  const vbMatch = svgText.match(/viewBox=["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/);
  const w = vbMatch ? parseFloat(vbMatch[1]) : 1920;
  const h = vbMatch ? parseFloat(vbMatch[2]) : 1080;

  // Hidden container so path geometry can be measured by the browser.
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;opacity:0;pointer-events:none;overflow:hidden;`;
  wrap.innerHTML = svgText;
  document.body.appendChild(wrap);

  const svgEl = wrap.querySelector('svg');
  if (!svgEl) { document.body.removeChild(wrap); return null; }
  svgEl.setAttribute('width', w); svgEl.setAttribute('height', h);

  const segs = [];
  const ref = svgEl.createSVGPoint ? svgEl.createSVGPoint() : null;

  wrap.querySelectorAll('path').forEach(path => {
    try {
      const len = path.getTotalLength();
      if (!len) return;
      // Sample density: ~1 point every 2px of path length, clamped to 300–3000 points.
      const n = Math.min(3000, Math.max(300, Math.ceil(len / 2)));
      let ctm = null;
      try { ctm = path.getCTM(); } catch (e) { } // transform matrix for nested SVG elements
      const seg = [];
      for (let i = 0; i <= n; i++) {
        const p = path.getPointAtLength(len * i / n);
        let wx = p.x, wy = p.y;
        // Apply the element's transform matrix if present.
        if (ctm && ref) {
          ref.x = p.x; ref.y = p.y;
          try { const t = ref.matrixTransform(ctm); wx = t.x; wy = t.y; } catch (e) { }
        }
        seg.push({ x: wx / w, y: wy / h }); // normalise to 0–1
      }
      if (seg.length) segs.push(seg);
    } catch (e) { }
  });

  document.body.removeChild(wrap);
  return { segs };
}

// Applies a parsed set of segments to the simulation: rebuilds the flow field,
// assigns particles to segments, and resets state ready for triggering.
function applySegments(segs, sceneMap) {
  // Ensure all paths flow left-to-right (flip if the first point is to the right of the last).
  segments = segs.map(seg => seg[0].x > seg[seg.length - 1].x ? seg.slice().reverse() : seg);
  segScene = sceneMap || segments.map(() => currentScene);

  buildField();

  allTriggered = false;
  segActive     = segments.map(() => false);
  segDelays     = segments.map((_, s) => DELAYS[s] || 0);
  segPendingTick = new Array(segments.length).fill(-1);

  // Distribute particles evenly across segments using modulo.
  for (let i = 0; i < MAX; i++) { pseg[i] = i % segments.length; pvx[i] = 0; pvy[i] = 0; pwait[i] = 0; }

  P.paused = true;
  btnPlay.textContent = '▶'; btnPlay.classList.remove('active');
  ctx.clearRect(0, 0, W, H); trailCtx.clearRect(0, 0, W, H);
  document.getElementById('panel').classList.remove('hidden');
  document.getElementById('hint').classList.remove('hidden');
}

function loadSVG(svgText) {
  const parsed = parseSVGText(svgText);
  if (!parsed || !parsed.segs.length) { alert('No paths found in the SVG.'); return; }
  applySegments(parsed.segs);
}

// Loads all three scene SVGs simultaneously and merges their segments.
// Each segment retains a reference to its source file for color lookup.
function loadAllScenes() {
  const urls = ['Pacifico.svg', 'Continental.svg', 'Costeiro.svg'];
  Promise.all(urls.map(u => fetch(u).then(r => r.ok ? r.text() : null).catch(() => null)))
    .then(texts => {
      const allSegs = [], allSceneMap = [];
      texts.forEach((txt, idx) => {
        if (!txt) return;
        const parsed = parseSVGText(txt);
        if (!parsed) return;
        parsed.segs.forEach(seg => { allSegs.push(seg); allSceneMap.push(urls[idx]); });
      });
      if (!allSegs.length) return;
      applySegments(allSegs, allSceneMap);
    });
}


// ─── Controls ──────────────────────────────────────────────────────────────────

const btnPlay = document.getElementById('btnPlay');
btnPlay.addEventListener('click', () => {
  P.paused = !P.paused;
  btnPlay.textContent = P.paused ? '▶' : '⏸';
  btnPlay.classList.toggle('active', !P.paused);
  // First play triggers all segments (with their delays).
  if (!P.paused && !allTriggered) triggerAll();
});

document.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (key === ' ') { btnPlay.click(); e.preventDefault(); }
  if (key === 's' && segments.length) {
    // S — start (same as pressing play).
    P.paused = false; btnPlay.textContent = '⏸'; btnPlay.classList.add('active');
    triggerAll();
  }
  if (key === 'r' && segments.length) {
    // R — restart from the beginning without reloading the SVG.
    doReset();
    P.paused = false; btnPlay.textContent = '⏸'; btnPlay.classList.add('active');
    triggerAll();
  }
});

// ─── Scene buttons ─────────────────────────────────────────────────────────────
document.querySelectorAll('.scene-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    if (btn.dataset.svg === 'todos') { loadAllScenes(); }
    else { loadSVGFromUrl(btn.dataset.svg); }
  });
});

// ─── URL parameter automation ──────────────────────────────────────────────────
// Allows loading a specific scene via ?scene=pacifico (or todos, continental, costeiro).
(function applyURLParams() {
  const params = new URLSearchParams(location.search);
  const scene = params.get('scene');
  if (scene === 'todos') {
    window._autoScene = 'todos';
  } else if (scene) {
    const sceneMap = { pacifico: 'Pacifico.svg', continental: 'Continental.svg', costeiro: 'Costeiro.svg' };
    window._autoScene = sceneMap[scene.toLowerCase()] || scene;
  }
})();

// Auto-load: URL param takes priority, otherwise default to Pacifico.
const _startScene = window._autoScene || 'Pacifico.svg';
if (_startScene === 'todos') { loadAllScenes(); } else { loadSVGFromUrl(_startScene); }

// Sync the active state on the scene buttons to match what was auto-loaded.
document.querySelectorAll('.scene-btn').forEach(b => {
  b.classList.toggle('active', b.dataset.svg === _startScene);
});


// ─── Resize ────────────────────────────────────────────────────────────────────
// Resize the canvas and rebuild the flow field whenever the window size changes.
window.addEventListener('resize', () => {
  W = canvas.width = Math.min(window.innerWidth, 1920);
  H = canvas.height = Math.min(window.innerHeight, 1080);
  trailCanvas.width = W;
  trailCanvas.height = H;
  buildField();
});
