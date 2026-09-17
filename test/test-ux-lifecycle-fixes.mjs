// test/test-ux-lifecycle-fixes.mjs
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import fs from 'fs';
import assert from 'assert';

const BROWSER_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log(`Using browser: ${BROWSER_PATH}`);

function waitMessage(ws, expectedType) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for message type: ${expectedType}`));
    }, 5000);

    const onMessage = (data) => {
      const msg = JSON.parse(data.toString());
      if (!expectedType || msg.type === expectedType) {
        clearTimeout(timeout);
        ws.off('message', onMessage);
        resolve(msg);
      }
    };
    ws.on('message', onMessage);
  });
}

async function testBackendDelay() {
  console.log('\n--- 1. Testing Backend 100ms Delay on Room Creation ---');
  const ws = new WebSocket('ws://localhost:3000');
  await new Promise(res => ws.on('open', res));

  const start = Date.now();
  ws.send(JSON.stringify({ type: 'create-room' }));
  const msg = await waitMessage(ws, 'room-created');
  const duration = Date.now() - start;
  ws.close();

  console.log(`Room created: ${msg.code}, time taken: ${duration}ms`);
  assert(duration >= 95, `Expected duration to be at least ~100ms, got ${duration}ms`);
  console.log('✓ Verified: Backend 100ms delay enforced on room creation');
}

async function testAnimationsAndURL() {
  console.log('\n--- 2. Testing Animation Smoothness & URL Updates ---');
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 800 });
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // Initial Idle state
    const initialHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    console.log(`Initial Idle card height: ${initialHeight}px`);
    assert(page.url().endsWith(':3000/'), `Expected URL to be root, got ${page.url()}`);

    // Click "Join Connection"
    console.log('Clicking "Join Connection"...');
    await page.evaluate(() => document.getElementById('btn-show-join').click());
    
    // Sample height during transition to Join
    await new Promise(r => setTimeout(r, 100));
    const joinMidHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    console.log(`Card height 100ms into Join transition: ${joinMidHeight}px`);
    await new Promise(r => setTimeout(r, 400));
    const joinFinalHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    console.log(`Final Join card height: ${joinFinalHeight}px`);
    assert(joinFinalHeight < initialHeight, 'Join view should be shorter than Idle view');

    // Click "Back" from Join
    console.log('Clicking "Back" from Join...');
    await page.evaluate(() => document.getElementById('btn-back-join').click());
    await new Promise(r => setTimeout(r, 100));
    const backMidHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    console.log(`Card height 100ms into Back transition: ${backMidHeight}px`);
    await new Promise(r => setTimeout(r, 400));
    const backFinalHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    console.log(`Final Back card height: ${backFinalHeight}px`);
    assert.strictEqual(backFinalHeight, initialHeight, 'Should return to initial height smoothly');
    assert(page.url().endsWith(':3000/'), 'URL should be root');

    // Click "Create Connection"
    console.log('Clicking "Create Connection"...');
    await page.evaluate(() => document.getElementById('btn-create-room').click());
    
    // Wait for room to be created
    await page.waitForFunction(() => {
      const el = document.querySelector('#display-room-code');
      return el && el.textContent.trim() !== '------';
    }, { timeout: 5000 });

    const roomCode = await page.evaluate(() => document.querySelector('#display-room-code').textContent.trim());
    console.log(`Room created: ${roomCode}`);
    
    // Verify URL updated to /join/:code
    const currentUrl = page.url();
    console.log(`Current page URL after room creation: ${currentUrl}`);
    assert(currentUrl.includes(`/join/${roomCode}`), `Expected URL to include /join/${roomCode}`);
    console.log('✓ Verified: URL updated on room creation');

    await new Promise(r => setTimeout(r, 450));
    const waitingHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    console.log(`Waiting card height: ${waitingHeight}px`);
    assert(waitingHeight > initialHeight, 'Waiting view should be taller than Idle');

    // Now click "Cancel Connection"
    console.log('Clicking "Cancel Connection"...');
    await page.evaluate(() => document.getElementById('btn-cancel-waiting').click());

    // Sample height mid-transition (e.g. at 80ms)
    await new Promise(r => setTimeout(r, 80));
    const cancelH1 = await page.evaluate(() => {
      const card = document.querySelector('.main-card');
      return {
        styleHeight: card.style.height,
        offsetHeight: card.offsetHeight,
        code: document.querySelector('#display-room-code').textContent.trim()
      };
    });
    console.log(`80ms into Cancel: style.height=${cancelH1.styleHeight}, offsetHeight=${cancelH1.offsetHeight}px, code=${cancelH1.code}`);
    
    // Check that target height was properly applied (targetHeight should be around initialHeight ~426px, NOT stuck at 555px)
    assert(cancelH1.styleHeight.includes('px'), 'mainCard.style.height should be set during transition');
    const targetSet = parseInt(cancelH1.styleHeight, 10);
    assert(targetSet <= initialHeight + 5 && targetSet >= initialHeight - 5, `Target height should be ~${initialHeight}px, got ${targetSet}px`);

    await new Promise(r => setTimeout(r, 450));
    const cancelFinalHeight = await page.evaluate(() => document.querySelector('.main-card').offsetHeight);
    const finalUrl = page.url();
    const finalCode = await page.evaluate(() => document.querySelector('#display-room-code').textContent.trim());

    console.log(`After Cancel: offsetHeight=${cancelFinalHeight}px, URL=${finalUrl}, code=${finalCode}`);
    assert.strictEqual(cancelFinalHeight, initialHeight, 'Card should settle at initial height');
    assert(finalUrl.endsWith(':3000/'), `URL should revert to root, got ${finalUrl}`);
    assert.strictEqual(finalCode, '------', 'Room code should be reset to ------');
    console.log('✓ Verified: Cancel connection smoothly animates down, resets URL, and resets code display');

  } finally {
    await browser.close();
  }
}

async function testHostPersistenceOnDisconnect() {
  console.log('\n--- 3. Testing Host Lifecycle Persistence on Peer Disconnect ---');
  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  try {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await pageA.setViewport({ width: 900, height: 800 });
    await pageB.setViewport({ width: 900, height: 800 });

    pageA.on('console', msg => console.log('[Tab A]', msg.type(), msg.text()));
    pageB.on('console', msg => console.log('[Tab B]', msg.type(), msg.text()));

    // 1. Device A opens PeerDrop and creates a room
    console.log('Tab A: Opening PeerDrop and creating room...');
    await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));
    await pageA.waitForSelector('#btn-create-room');
    await pageA.evaluate(() => document.getElementById('btn-create-room').click());

    // Wait for room code
    let hostRoomCode = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      hostRoomCode = await pageA.evaluate(() => {
        const el = document.querySelector('#display-room-code');
        const text = el ? el.textContent.trim() : '';
        return (text && text !== '------') ? text : null;
      });
      if (hostRoomCode) break;
    }

    assert(hostRoomCode, 'Host room code should have been generated');
    console.log(`Tab A created room: ${hostRoomCode}`);
    assert(pageA.url().includes(`/join/${hostRoomCode}`), 'Tab A URL should be /join/CODE');

    // 2. Device B opens the deep link
    console.log(`Tab B: Opening deep link http://localhost:3000/join/${hostRoomCode}...`);
    await pageB.goto(`http://localhost:3000/join/${hostRoomCode}`, { waitUntil: 'networkidle0' });

    // Verify Tab B auto-fills code and banner
    const bInputValue = await pageB.evaluate(() => document.getElementById('input-room-code').value);
    const bBannerVisible = await pageB.evaluate(() => {
      const el = document.getElementById('join-qr-banner');
      return el && el.style.display !== 'none';
    });
    assert.strictEqual(bInputValue, hostRoomCode, 'Tab B input should auto-fill room code');
    assert(bBannerVisible, 'Tab B join banner should be visible');
    console.log('✓ Verified: Tab B auto-fills room code and shows banner from URL');

    // 3. Device B clicks Connect
    console.log('Tab B: Clicking Connect...');
    await pageB.evaluate(() => document.getElementById('btn-connect').click());

    // Wait for both to connect
    console.log('Waiting for P2P connection to establish...');
    let connectedA = false;
    let connectedB = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 250));
      connectedA = await pageA.evaluate(() => {
        const el = document.querySelector('#view-connected');
        return el && el.classList.contains('active');
      });
      connectedB = await pageB.evaluate(() => {
        const el = document.querySelector('#view-connected');
        return el && el.classList.contains('active');
      });
      if (connectedA && connectedB) break;
    }
    assert(connectedA && connectedB, `P2P connection failed. Connected A: ${connectedA}, Connected B: ${connectedB}`);
    console.log('✓ Tab A and Tab B are connected in P2P mode!');

    // 4. Tab B disconnects itself
    console.log('Tab B clicks [ Disconnect ]...');
    await pageB.evaluate(() => document.getElementById('btn-disconnect').click());

    // Verify Tab B returns to Idle, URL is reset to /, input is cleared
    let bIdle = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      bIdle = await pageB.evaluate(() => document.getElementById('view-idle').classList.contains('active'));
      if (bIdle) break;
    }
    assert(bIdle, 'Tab B should return to idle view');
    const bFinalUrl = pageB.url();
    const bFinalInput = await pageB.evaluate(() => document.getElementById('input-room-code').value);
    console.log(`Tab B after disconnect: URL=${bFinalUrl}, input="${bFinalInput}"`);
    assert(bFinalUrl.endsWith(':3000/'), `Tab B URL should reset to root /, got ${bFinalUrl}`);
    assert.strictEqual(bFinalInput, '', 'Tab B input code should be cleared');
    console.log('✓ Verified: Tab B (Guest) reset cleanly to idle, URL / and input cleared');

    // 5. CRITICAL CHECK: Verify Tab A (Host) does NOT reset to initial screen!
    console.log('Checking Tab A (Host) state after peer left...');
    await new Promise(r => setTimeout(r, 800));

    const hostState = await pageA.evaluate(() => {
      return {
        isWaitingActive: document.getElementById('view-waiting').classList.contains('active'),
        isIdleActive: document.getElementById('view-idle').classList.contains('active'),
        code: document.querySelector('#display-room-code').textContent.trim(),
        statusText: document.getElementById('global-status-text')?.textContent.trim() || ''
      };
    });
    const hostUrl = pageA.url();

    console.log(`Tab A state: waitingActive=${hostState.isWaitingActive}, idleActive=${hostState.isIdleActive}, code=${hostState.code}, status="${hostState.statusText}", URL=${hostUrl}`);
    assert(hostState.isWaitingActive, 'Tab A should remain in WAITING view, not idle!');
    assert(!hostState.isIdleActive, 'Tab A should NOT be in idle view!');
    assert.strictEqual(hostState.code, hostRoomCode, 'Tab A room code should be preserved!');
    assert(hostUrl.includes(`/join/${hostRoomCode}`), 'Tab A URL should be preserved');
    console.log('✓ CRITICAL: Tab A did NOT reset to initial screen! It preserved its room and waiting view.');

    // 6. Device B (or another device) re-joins Tab A's active room
    console.log('Tab B re-joins the same room code to verify persistence...');
    await pageB.evaluate((code) => {
      document.getElementById('btn-show-join').click();
      document.getElementById('input-room-code').value = code;
      document.getElementById('btn-connect').click();
    }, hostRoomCode);

    // Wait for both to reconnect!
    let reconnectedA = false;
    let reconnectedB = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 250));
      reconnectedA = await pageA.evaluate(() => {
        const el = document.querySelector('#view-connected');
        return el && el.classList.contains('active');
      });
      reconnectedB = await pageB.evaluate(() => {
        const el = document.querySelector('#view-connected');
        return el && el.classList.contains('active');
      });
      if (reconnectedA && reconnectedB) break;
    }
    assert(reconnectedA && reconnectedB, `P2P reconnection failed. A: ${reconnectedA}, B: ${reconnectedB}`);
    console.log('✓ CRITICAL: Reconnection successful! Tab B rejoined Tab A without regenerating code.');

  } finally {
    await browser.close();
  }
}

async function main() {
  try {
    await testBackendDelay();
    await testAnimationsAndURL();
    await testHostPersistenceOnDisconnect();
    console.log('\n=========================================');
    console.log('  ALL LIFECYCLE & UX FIXES VERIFIED 100% ');
    console.log('=========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  }
}

main();
