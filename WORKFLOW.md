# Camera-Movements Workflow

How images, SHP extents, and GeoJSON data fit together — and how to prepare
files correctly for every new project.

---

## 1. Coordinate System

Everything uses **Eckert III (EPSG:54008)**, an equal-area projection measured
in **metres**. This is the CRS of your SHP files and the values you paste into
`camera-movements.js`.

> If your SHP files are in a different CRS, reproject them to Eckert III in
> QGIS before reading the extents.

---

## 2. The Two SHP Extent Rectangles

You need two rectangular SHP files — one per map image:

| Variable in JS | SHP file       | Image it governs |
|----------------|----------------|------------------|
| `GLOBAL`       | Global Extent  | Background image |
| `AFRICA`       | Africa Extent  | Overlay image    |

These rectangles define the **geographic content** of each image. The code uses
them to position and scale every layer.

### How to read the extent values

1. Open QGIS.
2. Select the extent SHP layer → **Layer Properties → Information → Extent**.
3. Make sure the CRS shown is **Eckert III / EPSG:54008**.
4. Copy the four numbers into `camera-movements.js`:

```js
const GLOBAL = { xmin: ..., xmax: ..., ymin: ..., ymax: ... };
const AFRICA = { xmin: ..., xmax: ..., ymin: ..., ymax: ... };
```

---

## 3. Exporting Images from QGIS

### 3.1 Projection Setup

Set the QGIS project CRS to **EPSG:54008 (Eckert III)** before exporting.

### 3.2 Print Layout export

1. Open **Project → New Print Layout**.
2. Set the page size to match your target pixel ratio (e.g. 16:9 for 8K export
   at 7680 × 4320 px).
3. Add a **Map item**, then lock it.
4. In Map item properties → **Extent**, set it to match your SHP rectangle
   exactly (copy the same xmin/xmax/ymin/ymax values).
5. Export as PNG at your target resolution.

### 3.3 The Aspect-Ratio Mismatch Rule

This is the most important rule to understand:

- The **GLOBAL SHP extent** is a 2:1 rectangle (Eckert III world bounds are
  always ~2:1).
- A **16:9 image canvas** is 1.78:1.
- These do not match.

When QGIS exports a map with a 2:1 geographic extent into a 16:9 canvas it
**expands the extent north and south** to fill the frame. The content outside
the original SHP rectangle is rendered as **transparent (alpha) pixels**.

**The JS code accounts for this automatically** using the formula:

```
imageGeoH  = gW × (IH / IW)       ← true geographic height of the image
imageYmax  = geoYCenter + imageGeoH / 2   ← true top edge of the image
```

This works as long as:
- The image was exported with the **SHP rectangle centered** in the canvas.
- The **x-axis (width) matches exactly** — i.e. GLOBAL.xmin/xmax align with the
  left and right pixel edges of the image.

**If QGIS crops instead of expanding**, you'll see the geographic content cut
off. Always export with "Resize to extent" off and let QGIS add transparent
padding.

### 3.4 Overlay Image Rule

The overlay image (Africa, or any regional map) should ideally have its SHP
extent match the image aspect ratio to avoid any padding. In practice, a small
mismatch (< 0.1%) is fine — the same formula handles it. The overlay is placed
with `preserveAspectRatio: none` so it stretches to exactly the computed pixel
bounds.

---

## 4. GeoJSON / Vector Data

GeoJSON files must be **in Eckert III projected metres** (not geographic
degrees). The custom D3 projection in the JS converts those metres directly
to pixels.

### Export GeoJSON from QGIS

1. Right-click the SHP layer → **Export → Save Features As**.
2. Format: **GeoJSON**.
3. CRS: **EPSG:54008 (Eckert III)**.
4. Click OK. Place the `.geojson` file in the same folder as `index.html`.

### Update the fetch path in the JS

```js
fetch('your-data.geojson').then(r => r.json())
```

---

## 5. Checklist for a New Project

- [ ] Project CRS set to EPSG:54008 in QGIS.
- [ ] Two SHP extent rectangles created (global + regional).
- [ ] Extents read from Layer Properties → Information (not the print layout dialog).
- [ ] Background image exported with GLOBAL extent centred in the canvas, alpha
      padding on top/bottom if canvas is 16:9.
- [ ] Overlay image exported with AFRICA (or regional) extent centred in the canvas.
- [ ] GeoJSON exported in EPSG:54008 (projected metres, not degrees).
- [ ] `GLOBAL` and `AFRICA` constants updated in `camera-movements.js`.
- [ ] `CONFIG.bgImage` and `CONFIG.overlayImage` filenames updated.
- [ ] `CONFIG.zoomTarget` set to `[longitude, latitude]` in decimal degrees
      (copy straight from Google Maps — right-click any point → copy coordinates).
- [ ] Debug rectangles (cyan/yellow) visually align with image content in the
      browser before removing them.
- [ ] Animation tuning done (see Section 7 below).

---

## 7. Animation Tuning

All animation values are in `CONFIG` at the top of `camera-movements.js`.

### Camera fly-in

| Parameter | What it does |
|---|---|
| `transitionDuration` | Total fly-in time in ms. 1200–1800 is cinematic. |
| `transitionEasing` | CSS easing for the pan/zoom. Use `cubic-bezier()` strings. |
| `zoomTargetScale` | Zoom level on arrival (1 = fit screen, 2 = 2× zoom). |

Good CSS easing strings for the camera:
```
'cubic-bezier(0.645, 0.045, 0.355, 1)'  ← ease-in-out (default, cinematic)
'cubic-bezier(0.22, 1, 0.36, 1)'        ← expo ease-out (snappy)
'ease-in-out'                            ← browser default S-curve
```

### Crossfade

| Parameter | What it does |
|---|---|
| `crossfadeDuration` | How long the opacity dissolve takes in ms. |
| `crossfadeLeadIn` | How many ms before the camera stops the fade begins. Tune this so the swap lands exactly as the camera settles. 400–600 works well with ease-in-out camera easings because the camera is nearly still in the last ~500ms. |
| `crossfadeEasing` | CSS easing string for the opacity dissolve. |

Good CSS easing strings for the crossfade:
```
'ease-in-out'                            ← smooth S-curve
'cubic-bezier(0.87, 0, 0.13, 1)'        ← approx. exp-in-out (dramatic)
'linear'                                 ← constant dissolve (smoothest perceived)
```

### GPU performance

Both images have `translateZ(0)` and `will-change: opacity` applied at load time. This forces the browser to upload the image textures to the GPU immediately, so there is no upload stutter when the crossfade begins. Do not remove these.

---

## 6. How the Pixel Formula Works

For any geographic coordinate `(mx, my)` in Eckert III metres, the pixel
position inside the background image is:

```
px = (mx        - GLOBAL.xmin) / gW        × IW
py = (imageYmax - my)           / imageGeoH × IH
```

Where:
- `gW`        = `GLOBAL.xmax - GLOBAL.xmin` (full geographic width)
- `imageGeoH` = `gW × IH / IW` (geographic height derived from pixel aspect ratio)
- `imageYmax` = midpoint of GLOBAL y-range + `imageGeoH / 2`
- `IW`, `IH`  = natural pixel dimensions of the background image

The overlay is positioned using the same formula, substituting AFRICA values
for `mx`/`my`. The GeoJSON vector paths use an identical custom D3 projection
so all layers share the same coordinate space.
