const { chromium } = require('playwright');
const path = require('path');

(async () => {
  // Real Chrome with new headless — supports large viewports + rAF runs at full speed
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--allow-file-access-from-files',
      '--headless=new',
      '--disable-gpu-vsync',
      '--run-all-compositor-stages-before-draw'
    ]
  });

  const context = await browser.newContext({
    viewport: { width: 3840, height: 1920 },
    recordVideo: {
      dir: path.join(__dirname, 'videos'),
      size: { width: 3840, height: 1920 }
    }
  });

  const page = await context.newPage();
  const url = `file:///Users/suplab/Poles/index_flowfield.html?scene=pacifico&4k&autoplay&hideui`;

  console.log('Opening page...');
  await page.goto(url, { waitUntil: 'load' });
  console.log('Waiting 2s for animation to start...');
  // Hide UI immediately on load
  await page.evaluate(() => {
    document.getElementById('panel').style.display = 'none';
    document.getElementById('hint').style.display = 'none';
    document.getElementById('spawnersPanel').style.display = 'none';
    document.getElementById('sceneBar').style.display = 'none';
  });

  console.log('Waiting 10s for trails to fill...');
  await page.waitForTimeout(8000);

  await page.screenshot({ path: path.join(__dirname, 'videos', 'test-frame-4k.png') });
  console.log('Frame captured. Waiting 2 more seconds...');

  await page.waitForTimeout(2000);
  const videoPath = await page.video().path();
  await context.close();
  await browser.close();

  const { statSync } = require('fs');
  const kb = (statSync(videoPath).size / 1024).toFixed(1);
  console.log(`Video: ${videoPath} (${kb} KB)`);
})();
