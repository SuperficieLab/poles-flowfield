// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG = {
  bgImage:      'BASE-MUNDO AFRICA 8 K.png',
  overlayImage: 'BASE-MUNDO AFRICA - MAPA 10 8K.png',

  zoomTarget:      [0, -940000], // Eckert III metres — roughly [0°, -10°]
  zoomTargetScale: 1.5,

  transitionDuration: 1500,
  transitionEasing:  'cubic-bezier(0.645, 0.045, 0.355, 1)', // cinematic

  scrollZoomEnabled: true,
  zoomMin:     2.3,
  zoomInitial: 1,
  zoomMax:     8,

  crossfadeDuration: 1000,
  crossfadeOverlap:  1000,
};

const CROSSFADE = `opacity ${CONFIG.crossfadeDuration}ms cubic-bezier(0.645, 0.045, 0.355, 1)`;

// ─── Extents in Eckert III projected metres (raw from SHP files) ─────────────

const GLOBAL = { xmin: -16921197.759, xmax: 16921200.822, ymin: -8460599.396, ymax: 8460601.462 };
const AFRICA = { xmin:  -8509252.682, xmax:  8509255.745, ymin: -5592144.858, ymax: 3980766.133 };

// ─── Preload images ──────────────────────────────────────────────────────────

async function preloadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode();
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

async function load() {
  const [[bg], raisg] = await Promise.all([
    Promise.all([
      preloadImage(CONFIG.bgImage),
      preloadImage(CONFIG.overlayImage),
    ]),
    fetch('raisg-lim.geojson').then(r => r.json()),
  ]);
  init(bg.w, bg.h, raisg);
}

load().catch(console.error);

function init(IW, IH, raisg) {

// ─── Setup ───────────────────────────────────────────────────────────────────

const svg = d3.select('#map');
const W = window.innerWidth;
const H = window.innerHeight;

svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');


// ─── Overlay position — direct linear mapping from Eckert III metres to pixels ─

const gW = GLOBAL.xmax - GLOBAL.xmin;
const gH = GLOBAL.ymax - GLOBAL.ymin;

const ox = (AFRICA.xmin - GLOBAL.xmin) / gW * IW;
const oy = (GLOBAL.ymax - AFRICA.ymax) / gH * IH;
const ow = (AFRICA.xmax - AFRICA.xmin) / gW * IW;
const oh = (AFRICA.ymax - AFRICA.ymin) / gH * IH;

// ─── Root group ──────────────────────────────────────────────────────────────

const g = svg.append('g').attr('id', 'root')
  .style('will-change', 'transform')
  .style('transform-origin', '0 0');

// ─── Images ──────────────────────────────────────────────────────────────────

g.append('image')
  .attr('id', 'bg-image')
  .attr('href', CONFIG.bgImage)
  .attr('x', 0).attr('y', 0)
  .attr('width', IW).attr('height', IH)
  .style('image-rendering', 'high-quality');

g.append('image')
  .attr('id', 'overlay-image')
  .attr('href', CONFIG.overlayImage)
  .attr('x', ox).attr('y', oy)
  .attr('width', ow).attr('height', oh)
  .attr('preserveAspectRatio', 'none')
  .style('image-rendering', 'high-quality')
  .style('will-change', 'opacity')
  .style('opacity', '0')
  .style('transition', CROSSFADE);

// ─── Extents debug ───────────────────────────────────────────────────────────

g.append('rect')
  .attr('x', 0).attr('y', 0).attr('width', IW).attr('height', IH)
  .attr('fill', 'none').attr('stroke', 'cyan').attr('stroke-width', 4);

g.append('rect')
  .attr('x', ox).attr('y', oy).attr('width', ow).attr('height', oh)
  .attr('fill', 'none').attr('stroke', 'yellow').attr('stroke-width', 4);

// ─── Data layers ─────────────────────────────────────────────────────────────

const bgDataLayer = g.append('g').attr('id', 'bg-data');

const overlayDataLayer = g.append('g').attr('id', 'overlay-data')
  .style('opacity', '0')
  .style('transition', CROSSFADE);

const eck3ToPixel = d3.geoTransform({
  point(x, y) {
    this.stream.point(
      (x - GLOBAL.xmin) / gW * IW,
      (GLOBAL.ymax - y) / gH * IH
    );
  }
});
const path = d3.geoPath(eck3ToPixel);

function drawRaisg(layer, color) {
  layer.append('path')
    .datum(raisg)
    .attr('d', path)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 3);
}

drawRaisg(bgDataLayer,      '#ff3300');
drawRaisg(overlayDataLayer, '#ff3300');

// ─── Zoom ────────────────────────────────────────────────────────────────────

let scrollZoomActive = true;
const fitScale = Math.min(W / IW, H / IH);

const zoom = d3.zoom()
  .extent([[0, 0], [W, H]])
  .scaleExtent([CONFIG.zoomMin * fitScale, CONFIG.zoomMax * fitScale])
  .filter(event => CONFIG.scrollZoomEnabled && scrollZoomActive && event.type === 'wheel')
  .on('zoom', event => {
    const { x, y, k } = event.transform;
    g.style('transform', `translate(${x}px,${y}px) scale(${k})`);
    document.getElementById('zoomReadout').textContent = `z ${(k / fitScale).toFixed(2)}`;
  });

svg.call(zoom);

const initialTransform = d3.zoomIdentity
  .translate((W - IW * fitScale) / 2, (H - IH * fitScale) / 2)
  .scale(fitScale * CONFIG.zoomInitial);
zoom.transform(svg, initialTransform);

if (!CONFIG.scrollZoomEnabled)
  window.addEventListener('wheel', e => e.preventDefault(), { passive: false });

// ─── Transition ──────────────────────────────────────────────────────────────

let triggered = false;

function fireTransition() {
  if (triggered) return;
  triggered = true;

  document.getElementById('transitionBtn').classList.add('active');

  const [mx, my] = CONFIG.zoomTarget;
  const tx = (mx - GLOBAL.xmin) / gW * IW;
  const ty = (GLOBAL.ymax - my) / gH * IH;
  const bg      = document.getElementById('bg-image');
  const overlay = document.getElementById('overlay-image');

  // CSS transition on the group — zero JS per frame, full GPU compositing.
  const easing = CONFIG.transitionEasing;
  const k = CONFIG.zoomTargetScale * fitScale;
  const x = W / 2 - tx * k;
  const y = H / 2 - ty * k;

  g.style('transition', `transform ${CONFIG.transitionDuration}ms ${easing}`);
  g.style('transform',  `translate(${x}px,${y}px) scale(${k})`);

  // Sync D3 zoom state after animation so scroll zoom works correctly.
  g.node().addEventListener('transitionend', () => {
    g.style('transition', null);
    zoom.transform(svg, d3.zoomIdentity.translate(x, y).scale(k));
    scrollZoomActive = true;
  }, { once: true });

  bg.style.transition      = CROSSFADE;
  overlay.style.transition = CROSSFADE;

  setTimeout(() => {
    overlay.style.opacity = '1';
    bg.style.opacity      = '0';
    overlayDataLayer.style('opacity', '1');
    bgDataLayer.style('opacity', '0');
  }, CONFIG.transitionDuration - CONFIG.crossfadeOverlap);
}

document.getElementById('transitionBtn').addEventListener('click', fireTransition);

}
