import puppeteer from 'puppeteer-core';
import fs from 'fs';

const BROWSER_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function captureScreenshots() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 860, deviceScaleFactor: 2 });

    // 1. Idle Hero View
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await page.screenshot({ path: 'test/screenshots/ui-idle-refined.png' });
    console.log('? Captured ui-idle-refined.png');

    // 2. Waiting Screen with QR Code
    await page.evaluate(() => document.getElementById('btn-create-room').click());
    await new Promise(r => setTimeout(r, 1200));
    await page.screenshot({ path: 'test/screenshots/ui-waiting-refined.png' });
    console.log('? Captured ui-waiting-refined.png');

    // 3. Connect a second tab to show the refined Connected Drop Zone
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 960, height: 860, deviceScaleFactor: 2 });
    await page2.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    const roomCode = await page.evaluate(() => document.getElementById('display-room-code')?.innerText);
    await page2.evaluate((code) => {
      document.getElementById('btn-show-join').click();
      document.getElementById('input-room-code').value = code;
      document.getElementById('btn-connect').click();
    }, roomCode);

    // Wait for connection
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'test/screenshots/ui-connected-refined.png' });
    console.log('? Captured ui-connected-refined.png');

    // 4. Mobile Viewport Screenshot (iPhone 14 / modern mobile size)
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
    await mobilePage.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await mobilePage.screenshot({ path: 'test/screenshots/ui-mobile-refined.png' });
    console.log('? Captured ui-mobile-refined.png');

  } finally {
    await browser.close();
  }
}

captureScreenshots().catch(console.error);
