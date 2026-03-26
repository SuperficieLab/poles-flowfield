const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SCENE = process.env.SCENE || 'pacifico';
const WAIT_MS = parseInt(process.env.WAIT_MS || '10000');
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, 'exports');
const OUT_FILE = path.join(OUT_DIR, `${SCENE}_4k.png`);

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    // macOS local: uncomment and set path to Chrome for --headless=new (supports large viewports + rAF)
    // executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--no-sandbox',           // required on Linux/Railway
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu-vsync',
      // '--headless=new',      // uncomment when using macOS Chrome above
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 3840, height: 1920 }
  });

  const page = await context.newPage();
  const url = `${BASE_URL}/index_flowfield.html?scene=${SCENE}&4k&autoplay&hideui`;

  console.log(`Opening: ${url}`);
  await page.goto(url, { waitUntil: 'load' });

  // Hide UI directly — reliable regardless of URL param parsing
  await page.evaluate(() => {
    document.getElementById('panel').style.display = 'none';
    document.getElementById('hint').style.display = 'none';
    document.getElementById('spawnersPanel').style.display = 'none';
    document.getElementById('sceneBar').style.display = 'none';
  });

  console.log(`Waiting ${WAIT_MS}ms for trails to fill...`);
  await page.waitForTimeout(WAIT_MS);

  await page.screenshot({ path: OUT_FILE });
  console.log(`Saved: ${OUT_FILE}`);

  await browser.close();
})();
