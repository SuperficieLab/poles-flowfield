// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG = {
  bgImage:      'BASE_MUNDO.png',
  overlayImage: 'BASE_AFRICA.png',

  // Geographic target of the zoom animation [longitude, latitude].
  zoomTarget: [5, -10],

  // How far in the camera zooms during the animation.
  zoomTargetScale: 2.2,

  // Duration of the transition (camera move + crossfade), in ms.
  transitionDuration: 1250,

  // Easing curve:
  // d3.easeCubicInOut  — slow start, fast middle, slow end (cinematic)
  // d3.easeLinear      — constant speed
  // d3.easeExpInOut    — very slow start/end, aggressive middle
  // d3.easeBackInOut   — slight overshoot at both ends
  transitionEase: d3.easeCubicInOut,

  // Zoom limits for manual scroll/drag.
  zoomMin: 1,
  zoomMax: 1.4,

  // Graticule + outline styles.
  graticuleColor: 'rgba(255,255,255,0.15)',
  graticuleWidth: 0.5,
  outlineColor:   'rgba(255,255,255,0.4)',
  outlineWidth:   1,

  transitionDelay: 380, // ms to wait before starting the crossfade (after camera starts moving) 
};

// ─── Preload images ──────────────────────────────────────────────────────────

function preloadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => src);
}

Promise.all([
  preloadImage(CONFIG.bgImage),
  preloadImage(CONFIG.overlayImage),
]).then(init).catch(console.error);

function init() {

// ─── Setup ───────────────────────────────────────────────────────────────────

const svg = d3.select('#map');
const W = window.innerWidth;
const H = window.innerHeight;

svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet');

const projection = d3.geoEckert3()
  .fitSize([W, H], { type: 'Sphere' });

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

// ─── Images ──────────────────────────────────────────────────────────────────

g.append('image')
  .attr('id', 'bg-image')
  .attr('href', CONFIG.bgImage)
  .attr('x', 0).attr('y', 0)
  .attr('width', W).attr('height', H)
  .attr('preserveAspectRatio', 'xMidYMid meet');

// Second image — same size/position as base, starts invisible.
// CSS transition (not D3 attr) so the crossfade runs on the compositor thread.
g.append('image')
  .attr('id', 'overlay-image')
  .attr('href', CONFIG.overlayImage)
  .attr('x', 0).attr('y', 0)
  .attr('width', W).attr('height', H)
  .attr('preserveAspectRatio', 'xMidYMid meet')
  .style('will-change', 'opacity')
  .style('opacity', '0')
  .style('transition', `opacity ${CONFIG.transitionDuration}ms cubic-bezier(0.645, 0.045, 0.355, 1)`);

// ─── Zoom ────────────────────────────────────────────────────────────────────
// filter(() => false) blocks all user interaction (scroll, drag, pinch) while
// still allowing programmatic calls like zoom.transform inside fireTransition.
const zoom = d3.zoom()
  .filter(() => false)
  .on('zoom', (event) => {
    g.attr('transform', event.transform);
  });

svg.call(zoom);

// Block browser-level pinch zoom and ctrl+scroll zoom.
window.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// ─── Transition ──────────────────────────────────────────────────────────────
// Fired by the button. Animates the camera toward zoomTarget and fades in
// the overlay simultaneously. One-shot — button disables itself after firing.
let triggered = false;

function fireTransition() {
  if (triggered) return;
  triggered = true;

  document.getElementById('transitionBtn').classList.add('active');

  const [tx, ty] = projection(CONFIG.zoomTarget);

  // Zoom-to-point: place target at viewport center, then scale up.
  const dest = d3.zoomIdentity
    .translate(W / 2, H / 2)
    .scale(CONFIG.zoomTargetScale)
    .translate(-tx, -ty);

  svg.transition()
    .duration(CONFIG.transitionDuration)
    .ease(CONFIG.transitionEase)
    .call(zoom.transform, dest);

  setTimeout(() => {  
  document.getElementById('overlay-image').style.opacity = '1';
  }, CONFIG.transitionDelay);
}

document.getElementById('transitionBtn').addEventListener('click', fireTransition);

} // end init
