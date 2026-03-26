# Flow Field — Agent Manual

This document tells an automated agent (Claude, Playwright, Puppeteer, etc.) everything needed to export each layer at 4K resolution.

---

## Files

| File | Purpose |
|------|---------|
| `index_flowfield.html` | Main app — open this in a browser |
| `Pacifico.svg` | Layer 1 — Pacific migration routes |
| `Continental.svg` | Layer 2 — Continental routes |
| `Costeiro.svg` | Layer 3 — Coastal routes |
| `MAPA_BASE.png` | Background world map |
| `flowfield-config.json` | (optional) Saved config to import |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `S` | Start / play all paths |
| `R` | Restart from zero |
| `Space` | Pause / resume |
| `H` | Hide/show UI (panel, hints, spawner) |
| `M` | Hide/show background map |
| `F` | Fit view to particles |
| `L` | Lock/unlock color (in TODOS mode locks color) |
| `E` | Export current canvas as PNG |
| `V` | Start/stop video recording (WebM) |

---

## Scene Buttons (top bar)

| Label | Loads |
|-------|-------|
| `pacifico` | `Pacifico.svg` |
| `continental` | `Continental.svg` |
| `costeiro` | `Costeiro.svg` |
| `todos` | All three combined |

---

## URL Parameters

Append these to the URL to automate without clicking:

| Parameter | Effect |
|-----------|--------|
| `?scene=pacifico` | Load Pacifico layer on open |
| `?scene=continental` | Load Continental layer |
| `?scene=costeiro` | Load Costeiro layer |
| `?scene=todos` | Load all layers combined |
| `?4k` | Set canvas to 3840×1920 (4K) |
| `?autoplay` | Auto-start animation immediately |
| `?hideui` | Hide panel, hints, scene bar on load |
| `?hidemap` | Hide background map on load |
| `?export=filename.png` | Auto-export PNG 8 seconds after load |

Parameters can be combined:
```
index_flowfield.html?scene=pacifico&4k&autoplay&hideui&export=pacifico_4k.png
```

---

## Export Each Layer at 4K — Step-by-Step

### Via URL parameters (recommended for agents)

Open each URL, wait ~10 seconds for animation to settle, PNG downloads automatically:

```
# Layer 1
file:///Users/suplab/Poles/index_flowfield.html?scene=pacifico&4k&autoplay&hideui&hidemap&export=pacifico_4k.png

# Layer 2
file:///Users/suplab/Poles/index_flowfield.html?scene=continental&4k&autoplay&hideui&hidemap&export=continental_4k.png

# Layer 3
file:///Users/suplab/Poles/index_flowfield.html?scene=costeiro&4k&autoplay&hideui&hidemap&export=costeiro_4k.png

# All layers combined
file:///Users/suplab/Poles/index_flowfield.html?scene=todos&4k&autoplay&hideui&hidemap&export=todos_4k.png
```

### Via Playwright (headless)

```js
const { chromium } = require('playwright');

const LAYERS = ['pacifico', 'continental', 'costeiro', 'todos'];
const BASE = 'file:///Users/suplab/Poles/index_flowfield.html';

(async () => {
  const browser = await chromium.launch();
  for (const layer of LAYERS) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 3840, height: 1920 });
    await page.goto(`${BASE}?scene=${layer}&4k&autoplay&hideui&hidemap`);
    await page.waitForTimeout(10000); // let animation run
    await page.screenshot({ path: `${layer}_4k.png`, fullPage: false });
    await page.close();
  }
  await browser.close();
})();
```

### Via keyboard manually

1. Open `index_flowfield.html` in Chrome
2. Click scene button (pacifico / continental / costeiro)
3. Press `S` to start
4. Wait for trails to fill (~8–10 seconds)
5. Press `H` to hide UI
6. Press `M` to hide map (optional — export particles only)
7. Press `E` to export PNG at current resolution

Repeat for each layer.

---

## Config Export / Import

- **Export**: Click ⬇ in the panel to download `flowfield-config.json`
- **Import**: Click ⬆ to load a config file — reloads the saved scene automatically
- Config includes: all sliders, color, bg opacity, zoom/pan position, delays per path, scene, todosMode

---

## Canvas Resolution

| Mode | Resolution | How |
|------|-----------|-----|
| Default | Window size (fullscreen) | Normal open |
| 4K | 3840 × 1920 | `?4k` URL param or call `set4K()` in console |

The 4K mode scales the canvas to 2× the SVG native resolution (1920×960) maintaining the correct aspect ratio.

---

## Notes for Agents

- The page auto-loads `Pacifico.svg` on open unless `?scene=` is specified
- Animation starts **paused** — always trigger `?autoplay` or press `S`
- `?export=` waits 8 seconds before downloading — increase this delay if trails need more time to fill
- If loading via `file://`, Chrome must be launched with `--allow-file-access-from-files`
- The background map (`MAPA_BASE.png`) is drawn behind particles. Use `?hidemap` to export particles-only (transparent-background PNG will show black canvas — background is filled black for recording compatibility)
