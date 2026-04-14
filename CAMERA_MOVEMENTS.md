# Camera Movements

A D3-based interactive world map with animated camera transitions, built as a standalone module alongside the flow field system.

## Files

| File | Role |
|---|---|
| `camera-movements.html` | Markup — SVG canvas + script tags |
| `camera-movements.css` | Layout and button styles (matches `index.html` design language) |
| `camera-movements.js` | All logic — projection, images, transition, zoom |

## How it works

- **Projection:** Eckert III (`d3.geoEckert3`) — a pseudo-cylindrical equal-area projection with rounded poles. Fitted to fill the viewport on load.
- **Background:** `BASE-MUNDO.jpg` rendered as an SVG `<image>` clipped to the Eckert III sphere oval, so it doesn't bleed outside the map boundary.
- **Overlay:** `BASE-MUNDO RECORTE AFRICA.jpg` stacked on top at the same coordinates, starts at `opacity: 0`.
- **Transition:** clicking the `transition` button fires a one-shot D3 animation — camera zooms toward the configured geographic target while the overlay fades in simultaneously.
- **Controls locked:** all manual zoom, drag, and browser pinch-zoom are disabled. Only the button moves the camera.

## Config (top of `camera-movements.js`)

```js
const CONFIG = {
  bgImage:            'BASE-MUNDO.jpg',
  overlayImage:       'BASE-MUNDO RECORTE AFRICA.jpg',

  zoomTarget:         [5, -10],   // [longitude, latitude] — where the camera moves to
  zoomTargetScale:    1.4,        // how far in the camera zooms (1 = fit-to-screen)

  transitionDuration: 1000,       // ms — higher = slower
  transitionEase:     d3.easeCubicInOut, // see comments for other options

  zoomMin:            1,
  zoomMax:            1.4,

  graticuleColor:     'rgba(255,255,255,0.15)',
  graticuleWidth:     0.5,
  outlineColor:       'rgba(255,255,255,0.4)',
  outlineWidth:       1,
};
```

## Adding CSV lat/lon data

The projection is already set up — any coordinate pair maps directly to SVG pixels:

```js
const [px, py] = projection([longitude, latitude]);
```

Append points or lines to the `#root` group (`g`) and they'll sit correctly on the map at any zoom level.

## Planned: Electron dual-monitor setup

The intended production environment is two monitors driven by a single Electron app:

```
HD window (control)           4K window (display)
┌─────────────────┐           ┌─────────────────┐
│  [transition]   │  ──IPC──► │  fireTransition │
│  renders at HD  │           │  renders at 4K  │
└─────────────────┘           └─────────────────┘
```

- Each `BrowserWindow` is assigned to a specific monitor via `screen.getAllDisplays()`
- Both load `camera-movements.html` with a `?role=control` / `?role=display` URL flag
- The HD window sends `ipcRenderer.send('transition')` on button click
- The main process forwards it; the 4K window calls `fireTransition()` on receive
- Each window renders independently at its native resolution — no downscaling
