// ─── Config ───────────────────────────────────────────────────────────────────
// All tuneable values live here. Edit only this block when adapting the file
// to a new project — no logic below should need to change.

const CONFIG = {
  // Filenames of the two PNG exports from QGIS (must be in the same folder).
  bgImage:      'BASE-MUNDO AFRICA 8 K.png',          // global / "before" image
  overlayImage: 'BASE-MUNDO AFRICA - MAPA 10 8K.png', // regional / "after" image

  // Where the camera zooms to when the transition button is pressed.
  // Use [longitude, latitude] in decimal degrees — paste straight from Google Maps.
  // Examples: [36.8, -1.3] = Nairobi   [18.4, -33.9] = Cape Town   [3.4, 6.5] = Lagos
  zoomTarget:      [0,8.5], // [lon, lat] decimal degrees
  zoomTargetScale: 2.1,        // zoom level after transition (1 = fit-to-screen)

  // Duration (ms) and CSS easing for the pan/zoom fly-in animation.
  // CSS transitions run on the compositor thread — smoother than JS-driven tweens.
  transitionDuration: 1500,
  transitionEasing:  'cubic-bezier(0.645, 0.045, 0.355, 1)', // cinematic ease-in-out

  // Scroll-wheel zoom. Disable if the page lives inside a scrollable layout.
  scrollZoomEnabled: true,
  zoomMin:     2.3, // minimum zoom multiplier relative to fit-to-screen
  zoomInitial: 1,   // starting zoom (1 = image fills the viewport)
  zoomMax:     8,   // maximum zoom multiplier

  // The crossfade swaps bgImage → overlayImage near the end of the camera move.
  // crossfadeLeadIn: ms before camera stops that the fade begins.
  //   0 = exactly when camera lands · 400 = while camera is nearly still (recommended)
  // crossfadeEasing: CSS easing string — runs on compositor thread like the camera.
  crossfadeDuration: 600,
  crossfadeLeadIn:   400,
  crossfadeEasing:  'ease-in-out',
};

// ─── Extents in Eckert III projected metres ───────────────────────────────────
// Copy these values straight from QGIS:
//   Layer → Properties → Information → Extent  (verify CRS = Eckert III / EPSG:54008)
//
// GLOBAL = extent of the SHP rectangle used when exporting the background image.
// AFRICA = extent of the SHP rectangle used when exporting the overlay image.
//
// IMPORTANT: use the SHP bounding box, not the "export extent" QGIS shows in the
// print layout — those can differ. See WORKFLOW.md for the full export checklist.

const GLOBAL = { xmin: -16921197.759, xmax: 16921200.822, ymin: -8460599.396, ymax: 8460601.462 };
const AFRICA = { xmin:  -8509252.682, xmax:  8509255.745, ymin: -5592144.858, ymax: 3980766.133 };

// ─── Lon/lat → Eckert III metres ─────────────────────────────────────────────
// Converts [longitude, latitude] in decimal degrees to Eckert III projected
// metres using d3.geoEckert3 scaled to Earth radius (6371008.8 m).
// This is the same formula QGIS uses so output matches your SHP extents.

const _eck3 = d3.geoEckert3().scale(6371008.8).translate([0, 0]);
function lonLatToEck3(lon, lat) { return _eck3([lon, lat]); }

// ─── Preload images ───────────────────────────────────────────────────────────
// Decode both PNGs before building the SVG so we have their exact pixel
// dimensions (IW × IH). Those dimensions drive every coordinate conversion.

async function preloadImage(src) {
  const img = new Image();
  img.src = src;
  await img.decode(); // waits until the browser fully decodes the file
  return { src, w: img.naturalWidth, h: img.naturalHeight };
}

async function load() {
  // Fetch bg image dimensions and GeoJSON data in parallel.
  // Only bg dimensions are used for the coordinate system (IW, IH).
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

// ─── init ─────────────────────────────────────────────────────────────────────
// Everything that touches the DOM runs inside init() so IW/IH are available.

function init(IW, IH, raisg) {

// ─── Viewport & SVG setup ─────────────────────────────────────────────────────
// The SVG fills the browser window. Its internal coordinate space is set to
// match the window in CSS pixels so 1 SVG unit = 1 CSS pixel everywhere.

const svg = d3.select('#map');
const W = window.innerWidth;
const H = window.innerHeight;

svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

// ─── Coordinate mapping: Eckert III metres → bg-image pixels ─────────────────
//
// The background image (IW × IH px) was exported from QGIS with GLOBAL as its
// geographic reference, but the image canvas is 16:9 while the GLOBAL Eckert III
// extent is 2:1. QGIS fills the canvas by EXPANDING the extent symmetrically
// north and south, leaving transparent (alpha) pixels in those extra bands.
//
// This means the image does NOT start at GLOBAL.ymax — it starts further north.
// We recover the true top edge by:
//   1. gW         = full geographic width of the image (= GLOBAL x-width, exact match)
//   2. imageGeoH  = geographic height = gW × (IH / IW)  ← derived from pixel ratio
//   3. geoYCenter = vertical midpoint of GLOBAL (≈ 0 m, near the equator)
//   4. imageYmax  = geoYCenter + imageGeoH / 2  ← true top edge of the image
//
// Universal pixel formula for any Eckert III coordinate (mx, my):
//   px = (mx        - GLOBAL.xmin) / gW        × IW
//   py = (imageYmax - my)           / imageGeoH × IH

const gW         = GLOBAL.xmax - GLOBAL.xmin;
const imageGeoH  = gW * IH / IW;                      // true geographic height
const geoYCenter = (GLOBAL.ymin + GLOBAL.ymax) / 2;   // ≈ equator
const imageYmax  = geoYCenter + imageGeoH / 2;         // top edge of bg image

// Pixel position and dimensions of the overlay within the bg-image space.
const ox = (AFRICA.xmin - GLOBAL.xmin) / gW        * IW; // overlay left edge
const oy = (imageYmax   - AFRICA.ymax) / imageGeoH  * IH; // overlay top  edge
const ow = (AFRICA.xmax - AFRICA.xmin) / gW        * IW; // overlay width
const oh = (AFRICA.ymax - AFRICA.ymin) / imageGeoH  * IH; // overlay height

// ─── Root group ───────────────────────────────────────────────────────────────
// All layers (images + vector data) share one <g id="root"> so a single CSS
// transform handles pan/zoom for everything at once via GPU compositing.

const g = svg.append('g').attr('id', 'root')
  .style('will-change', 'transform')
  .style('transform-origin', '0 0');

// ─── Images ───────────────────────────────────────────────────────────────────
// Background image: anchored at (0,0), sized to its natural pixel dimensions.
// The zoom transform on the parent <g> scales it — not the SVG attributes.

g.append('image')
  .attr('id', 'bg-image')
  .attr('href', CONFIG.bgImage)
  .attr('x', 0).attr('y', 0)
  .attr('width', IW).attr('height', IH)
  .style('image-rendering', 'high-quality')
  .style('will-change', 'opacity')
  .style('transform', 'translateZ(0)'); // force immediate GPU layer + texture upload

// Overlay image: positioned via extent math above, initially invisible.
// preserveAspectRatio:none tells the browser not to add its own letterboxing —
// the extent math already encodes the correct aspect ratio.

g.append('image')
  .attr('id', 'overlay-image')
  .attr('href', CONFIG.overlayImage)
  .attr('x', ox).attr('y', oy)
  .attr('width', ow).attr('height', oh)
  .attr('preserveAspectRatio', 'none')
  .style('image-rendering', 'high-quality')
  .style('will-change', 'opacity')
  .style('transform', 'translateZ(0)') // force immediate GPU layer + texture upload
  .style('opacity', '0');

// ─── Debug rectangles ─────────────────────────────────────────────────────────
// Cyan   = full bg-image bounds  (should hug the background image exactly)
// Yellow = overlay image bounds  (should hug the overlay image exactly)
// Remove once alignment is confirmed.

g.append('rect')
  .attr('x', 0).attr('y', 0).attr('width', IW).attr('height', IH)
  .attr('fill', 'none').attr('stroke', 'cyan').attr('stroke-width', 4);

g.append('rect')
  .attr('x', ox).attr('y', oy).attr('width', ow).attr('height', oh)
  .attr('fill', 'none').attr('stroke', 'yellow').attr('stroke-width', 4);

// ─── Data layers ──────────────────────────────────────────────────────────────
// The same GeoJSON boundary is drawn twice: once above the bg image, once above
// the overlay. Both fade together with the image crossfade so the correct
// styled version is always on top.

const bgDataLayer = g.append('g').attr('id', 'bg-data');

const overlayDataLayer = g.append('g').attr('id', 'overlay-data')
  .style('opacity', '0');

// Custom D3 projection: converts raw Eckert III metres from GeoJSON into
// SVG pixels using the same coordinate formula derived above.
const eck3ToPixel = d3.geoTransform({
  point(x, y) {
    this.stream.point(
      (x         - GLOBAL.xmin) / gW        * IW,
      (imageYmax - y)            / imageGeoH * IH
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

// ─── Zoom ─────────────────────────────────────────────────────────────────────
// fitScale = the uniform scale that makes the bg image fill the viewport along
// its tighter axis. All user-facing zoom levels are multiples of fitScale.

let scrollZoomActive = true;
const fitScale = Math.min(W / IW, H / IH);

const zoom = d3.zoom()
  .extent([[0, 0], [W, H]])                                     // pan boundary = viewport
  .scaleExtent([CONFIG.zoomMin * fitScale, CONFIG.zoomMax * fitScale])
  .filter(event => CONFIG.scrollZoomEnabled && scrollZoomActive && event.type === 'wheel')
  .on('zoom', event => {
    const { x, y, k } = event.transform;
    // CSS transform (not SVG transform attr) keeps compositing on the GPU.
    g.style('transform', `translate(${x}px,${y}px) scale(${k})`);
    document.getElementById('zoomReadout').textContent = `z ${(k / fitScale).toFixed(2)}`;
  });

svg.call(zoom);

// Centre the image in the viewport at the initial zoom level.
const initialTransform = d3.zoomIdentity
  .translate((W - IW * fitScale) / 2, (H - IH * fitScale) / 2)
  .scale(fitScale * CONFIG.zoomInitial);
zoom.transform(svg, initialTransform);

// Hard-block scroll events globally if zoom is off (prevents accidental page scroll).
if (!CONFIG.scrollZoomEnabled)
  window.addEventListener('wheel', e => e.preventDefault(), { passive: false });

// ─── Transition ───────────────────────────────────────────────────────────────
// fireTransition() runs once (guarded by `triggered`). It does three things:
//   1. Flies the camera to CONFIG.zoomTarget via a CSS transition (GPU, no rAF).
//   2. Starts the crossfade crossfadeLeadIn ms before the camera stops, so the
//      swap lands exactly as the camera settles (ease-in-out is nearly still by then).
//   3. Re-syncs D3's internal zoom state after the CSS animation finishes so
//      scroll-wheel zoom resumes from the correct position.

let triggered = false;

function fireTransition() {
  if (triggered) return;
  triggered = true;

  document.getElementById('transitionBtn').classList.add('active');
  scrollZoomActive = false; // block scroll zoom during camera move

  // Convert [lon, lat] degrees → Eckert III metres → bg-image pixel space.
  const [mx, my] = lonLatToEck3(...CONFIG.zoomTarget);
  const tx = (mx         - GLOBAL.xmin) / gW        * IW;
  const ty = (imageYmax  - my)           / imageGeoH * IH;

  const bg      = document.getElementById('bg-image');
  const overlay = document.getElementById('overlay-image');

  // Target transform: place pixel (tx, ty) at the viewport centre, scaled.
  const k = CONFIG.zoomTargetScale * fitScale;
  const x = W / 2 - tx * k;
  const y = H / 2 - ty * k;

  // CSS transition on the root group — compositor thread, zero JS per frame.
  g.style('transition', `transform ${CONFIG.transitionDuration}ms ${CONFIG.transitionEasing}`);
  g.style('transform',  `translate(${x}px,${y}px) scale(${k})`);

  // Re-sync D3 zoom state once the CSS animation fully ends.
  g.node().addEventListener('transitionend', () => {
    g.style('transition', null);
    zoom.transform(svg, d3.zoomIdentity.translate(x, y).scale(k));
    scrollZoomActive = true;
  }, { once: true });

  // Start crossfade independently — timed from animation start so it fires
  // when the camera is nearly still (ease-in-out is barely moving by then).
  const fadeCSS = `opacity ${CONFIG.crossfadeDuration}ms ${CONFIG.crossfadeEasing}`;
  const doCrossfade = () => {
    bg.style.transition      = fadeCSS;
    overlay.style.transition = fadeCSS;
    overlay.style.opacity    = '1';
    bg.style.opacity         = '0';
    overlayDataLayer.style('transition', fadeCSS).style('opacity', '1');
    bgDataLayer.style('transition', fadeCSS).style('opacity', '0');
  };

  setTimeout(doCrossfade, CONFIG.transitionDuration - CONFIG.crossfadeLeadIn);
}

document.getElementById('transitionBtn').addEventListener('click', fireTransition);

}
