import puppeteer from 'puppeteer-core';
import fs from 'fs';

const BROWSER_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer']
  });
  const page = await browser.newPage();
  page.on('console', m => console.log('PAGE LOG:', m.type(), m.text()));
  page.on('pageerror', m => console.error('PAGE ERROR:', m));

  await page.goto('http://localhost:3000');
  await page.evaluate(() => document.getElementById('btn-create-room').click());
  
  // Wait up to 5 seconds for room code to populate
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    const room = await page.evaluate(() => document.getElementById('display-room-code')?.innerText);
    if (room && room !== '------') {
      console.log('Got Room Code:', room);
      break;
    }
  }

  await browser.close();
}

test().catch(console.error);
