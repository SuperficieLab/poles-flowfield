// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG = {
  bgTiles:      'tiles/bg',
  overlayTiles: 'tiles/overlay',
  tileCols:   3,
  tileRows:   2,
  tileWidth:  4096,
  tileHeight: 3456,

  // Geographic target of the zoom animation [longitude, latitude].
  zoomTarget: [0, -10],

  // How far in the camera zooms during the animation.
  zoomTargetScale: 2.3,

  // Duration of the transition (camera move + crossfade), in ms.
  transitionDuration: 1250,

  // Easing curve:
  // d3.easeCubicInOut  — slow start, fast middle, slow end (cinematic)
  // d3.easeLinear      — constant speed
  // d3.easeExpInOut    — very slow start/end, aggressive middle
  // d3.easeBackInOut   — slight overshoot at both ends
  transitionEase: d3.easeCubicInOut,

  // Enable scroll-wheel zoom. zoomMin/zoomMax clamp the range.
  scrollZoomEnabled: true,
  zoomMin: 2.3,
  zoomInitial: 1,
  zoomMax: 8,

  // Graticule + outline styles.
  graticuleColor: 'rgba(255,255,255,0.15)',
  graticuleWidth: 0.5,
  outlineColor:   'rgba(255,255,255,0.4)',
  outlineWidth:   1,

  transitionDelay: 500,
};

// ─── Build tile list ─────────────────────────────────────────────────────────

function makeTiles(dir, cols, rows) {
  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({ src: `${dir}/tile_${row}_${col}.png`, row, col });
    }
  }
  return tiles;
}

const TW = CONFIG.tileWidth;
const TH = CONFIG.tileHeight;
const bgTiles      = makeTiles(CONFIG.bgTiles,      CONFIG.tileCols, CONFIG.tileRows);
const overlayTiles = makeTiles(CONFIG.overlayTiles, CONFIG.tileCols, CONFIG.tileRows);

init(TW * CONFIG.tileCols, TH * CONFIG.tileRows, bgTiles, overlayTiles, TW, TH);

function init(IW, IH, bgTiles, overlayTiles, TW, TH) {

// ─── Setup ───────────────────────────────────────────────────────────────────

const svg = d3.select('#map');
const W = window.innerWidth;
const H = window.innerHeight;

svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

const projection = d3.geoEckert3()
  .fitSize([IW, IH], { type: 'Sphere' });

const path = d3.geoPath().projection(projection);

// ─── Root group ──────────────────────────────────────────────────────────────
const g = svg.append('g').attr('id', 'root');

// ─── Sphere clip ─────────────────────────────────────────────────────────────
const spherePath = path({ type: 'Sphere' });

svg.append('defs')
  .append('clipPath')
  .attr('id', 'sphere-clip')
  .append('path')
  .attr('d', spherePath);

// ─── Tile helpers ────────────────────────────────────────────────────────────

function appendTiles(tiles, extraStyle = {}) {
  tiles.forEach(({ src, row, col }) => {
    const el = g.append('image')
      .attr('href', src)
      .attr('x', col * TW).attr('y', row * TH)
      .attr('width', TW).attr('height', TH)
      .style('image-rendering', 'high-quality');
    Object.entries(extraStyle).forEach(([k, v]) => el.style(k, v));
  });
}

// ─── Images ──────────────────────────────────────────────────────────────────

appendTiles(bgTiles);

appendTiles(overlayTiles, {
  'will-change': 'opacity',
  'opacity': '0',
  'transition': `opacity ${CONFIG.transitionDuration}ms cubic-bezier(0.645, 0.045, 0.355, 1)`,
});

// ─── Zoom ────────────────────────────────────────────────────────────────────
let scrollZoomActive = true;

const fitScale = Math.min(W / IW, H / IH);

const zoom = d3.zoom()
  .extent([[0, 0], [W, H]])
  .scaleExtent([CONFIG.zoomMin * fitScale, CONFIG.zoomMax * fitScale])
  .filter((event) => CONFIG.scrollZoomEnabled && scrollZoomActive && event.type === 'wheel')
  .on('zoom', (event) => {
    g.attr('transform', event.transform);
    document.getElementById('zoomReadout').textContent = `z ${(event.transform.k / fitScale).toFixed(2)}`;
  });

svg.call(zoom);

const initialTransform = d3.zoomIdentity
  .translate((W - IW * fitScale) / 2, (H - IH * fitScale) / 2)
  .scale(fitScale * CONFIG.zoomInitial);
zoom.transform(svg, initialTransform);

if (!CONFIG.scrollZoomEnabled) {
  window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
}

// ─── Transition ──────────────────────────────────────────────────────────────
let triggered = false;

function fireTransition() {
  if (triggered) return;
  triggered = true;

  document.getElementById('transitionBtn').classList.add('active');

  const [tx, ty] = projection(CONFIG.zoomTarget);

  const dest = d3.zoomIdentity
    .translate(W / 2, H / 2)
    .scale(CONFIG.zoomTargetScale * fitScale)
    .translate(-tx, -ty);

  svg.transition()
    .duration(CONFIG.transitionDuration)
    .ease(CONFIG.transitionEase)
    .call(zoom.transform, dest)
    .on('end', () => { scrollZoomActive = true; });

  setTimeout(() => {
    const allImages = g.selectAll('image').nodes();
    const overlayCount = CONFIG.tileCols * CONFIG.tileRows;
    allImages.slice(-overlayCount).forEach(el => { el.style.opacity = '1'; });
  }, CONFIG.transitionDelay);
}

document.getElementById('transitionBtn').addEventListener('click', fireTransition);

} // end init
