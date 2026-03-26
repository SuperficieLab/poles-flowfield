// Reads trail.svg, samples the path, outputs normalised points as JSON
const fs = require('fs');

const svg = fs.readFileSync('./trail.svg', 'utf8');

// ── Extract transforms ────────────────────────────────────────────────────────
// Outer g: matrix(1,0,0,1,4946.369444,-2155.892252)
// Inner g: matrix(5.555556,0,0,5.555556,-4942.202778,5000.706667)
// Combined: x_svg = 5.555556*x + 4.166666,  y_svg = 5.555556*y + 2844.814415
const SA = 5.555556, SB = 0, SC = 0, SD = 5.555556, SE = 4.166666, SF = 2844.814415;
const SVG_W = 4384, SVG_H = 2947;

function applyTransform(x, y) {
  return { x: (SA*x + SC*y + SE) / SVG_W, y: (SB*x + SD*y + SF) / SVG_H };
}

// ── Extract path d attribute ──────────────────────────────────────────────────
const dMatch = svg.match(/\bd="([^"]*)"/);
if (!dMatch) { console.error('No path found'); process.exit(1); }
const d = dMatch[1];

// ── Parse path commands ───────────────────────────────────────────────────────
// Format: M x,y  then repeated: C x1,y1 x2,y2 x,y
// Numbers are separated by spaces/commas, commands by letters
function parseNumbers(str) {
  return str.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
}

const tokens = d.match(/[MCLZz]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g);

let i = 0;
let cx = 0, cy = 0;   // current point
const segments = [];  // [{type, pts:[{x,y}...]}]

while (i < tokens.length) {
  const cmd = tokens[i];
  if (!/[MCLZz]/.test(cmd)) { i++; continue; }
  i++;

  if (cmd === 'M') {
    cx = parseFloat(tokens[i++]); cy = parseFloat(tokens[i++]);
    segments.push({ type: 'M', pts: [{ x: cx, y: cy }] });
  } else if (cmd === 'C') {
    const x1 = parseFloat(tokens[i++]), y1 = parseFloat(tokens[i++]);
    const x2 = parseFloat(tokens[i++]), y2 = parseFloat(tokens[i++]);
    const x  = parseFloat(tokens[i++]), y  = parseFloat(tokens[i++]);
    segments.push({ type: 'C', p0: {x:cx,y:cy}, p1:{x:x1,y:y1}, p2:{x:x2,y:y2}, p3:{x,y} });
    cx = x; cy = y;
  } else if (cmd === 'L') {
    const x = parseFloat(tokens[i++]), y = parseFloat(tokens[i++]);
    segments.push({ type: 'L', p0:{x:cx,y:cy}, p1:{x,y} });
    cx = x; cy = y;
  }
}

// ── Sample cubic bezier ───────────────────────────────────────────────────────
function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1-t;
  return {
    x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
    y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
  };
}

// Estimate arc length of a cubic segment (adaptive subdivision would be better but this is fine)
function cubicLength(p0, p1, p2, p3, steps=20) {
  let len = 0, prev = p0;
  for (let s=1; s<=steps; s++) {
    const pt = cubicAt(p0, p1, p2, p3, s/steps);
    len += Math.hypot(pt.x-prev.x, pt.y-prev.y);
    prev = pt;
  }
  return len;
}

// Collect all cubic/line segments and their lengths
const bezSegs = [];
for (const seg of segments) {
  if (seg.type === 'C') {
    const len = cubicLength(seg.p0, seg.p1, seg.p2, seg.p3);
    bezSegs.push({ ...seg, len });
  } else if (seg.type === 'L') {
    const len = Math.hypot(seg.p1.x-seg.p0.x, seg.p1.y-seg.p0.y);
    bezSegs.push({ type:'L', p0:seg.p0, p1:seg.p1, len });
  }
}

const totalLen = bezSegs.reduce((s, b) => s + b.len, 0);
console.error(`Total segments: ${bezSegs.length}, total length: ${totalLen.toFixed(1)}`);

// Sample N evenly-spaced points along arc length
const N = 800;
const points = [];
let accumulated = 0;
let segIdx = 0;

for (let k = 0; k <= N; k++) {
  const target = (k / N) * totalLen;

  // Advance segment pointer
  while (segIdx < bezSegs.length - 1 && accumulated + bezSegs[segIdx].len < target) {
    accumulated += bezSegs[segIdx].len;
    segIdx++;
  }

  const seg = bezSegs[segIdx];
  const localT = seg.len > 0 ? Math.min(1, (target - accumulated) / seg.len) : 0;

  let pt;
  if (seg.type === 'C') {
    pt = cubicAt(seg.p0, seg.p1, seg.p2, seg.p3, localT);
  } else {
    pt = { x: seg.p0.x + (seg.p1.x-seg.p0.x)*localT, y: seg.p0.y + (seg.p1.y-seg.p0.y)*localT };
  }

  const norm = applyTransform(pt.x, pt.y);
  // Clamp to reasonable bounds
  if (norm.x >= -0.1 && norm.x <= 1.1 && norm.y >= -0.1 && norm.y <= 1.1) {
    points.push([+norm.x.toFixed(5), +norm.y.toFixed(5)]);
  }
}

console.error(`Sampled ${points.length} points`);
console.error(`First: ${JSON.stringify(points[0])}, Last: ${JSON.stringify(points[points.length-1])}`);
process.stdout.write(JSON.stringify(points));
