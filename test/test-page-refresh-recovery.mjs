// test/test-page-refresh-recovery.mjs
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import assert from 'assert';

const BROWSER_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

console.log(`Using browser: ${BROWSER_PATH}`);

async function waitForP2PConnection(pageA, pageB, timeoutSec = 15) {
  const maxAttempts = timeoutSec * 4;
  let connectedA = false;
  let connectedB = false;

  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 250));
    connectedA = await pageA.evaluate(() => {
      const el = document.querySelector('#view-connected');
      return el && el.classList.contains('active');
    });
    connectedB = await pageB.evaluate(() => {
      const el = document.querySelector('#view-connected');
      return el && el.classList.contains('active');
    });
    if (connectedA && connectedB) return true;
  }
  throw new Error(`P2P connection timeout. Device A: ${connectedA}, Device B: ${connectedB}`);
}

async function runPageRefreshRecoveryTests() {
  console.log('\n======================================================');
  console.log('   PEERDROP REFRESH & SESSION RECOVERY TEST SUITE     ');
  console.log('======================================================\n');

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
    pageA.on('pageerror', err => console.log('[Tab A Error]', err.message));
    pageB.on('pageerror', err => console.log('[Tab B Error]', err.message));

    // ---------------------------------------------------------------
    // TEST 1: HOST REFRESHES WHILE IN WAITING VIEW
    // ---------------------------------------------------------------
    console.log('--- TEST 1: Host Refreshes While in Waiting View ---');
    await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 400));
    await pageA.evaluate(() => document.getElementById('btn-create-room').click());

    // Wait for room creation
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
    assert(hostRoomCode, 'Room code must be generated');
    console.log(`Host created room: ${hostRoomCode}`);
    assert(pageA.url().includes(`/join/${hostRoomCode}`), 'Host URL should be /join/CODE');

    // Host refreshes page!
    console.log('Host refreshes page while waiting for partner...');
    await pageA.reload({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 800));

    // Verify Host returned to Waiting view with same code
    const hostAfterReload = await pageA.evaluate(() => {
      return {
        isWaiting: document.getElementById('view-waiting').classList.contains('active'),
        code: document.querySelector('#display-room-code').textContent.trim()
      };
    });
    console.log(`Host after reload: isWaiting=${hostAfterReload.isWaiting}, code=${hostAfterReload.code}`);
    assert(hostAfterReload.isWaiting, 'Host should be in Waiting view after reload');
    assert.strictEqual(hostAfterReload.code, hostRoomCode, 'Host room code should be restored');
    assert(pageA.url().includes(`/join/${hostRoomCode}`), 'Host URL preserved');
    console.log('✓ TEST 1 PASSED: Host preserved room & waiting view across refresh!\n');

    // ---------------------------------------------------------------
    // TEST 2: GUEST JOINS & ESTABLISHES CONNECTION
    // ---------------------------------------------------------------
    console.log('--- TEST 2: Guest Joins Host Room ---');
    await pageB.goto(`http://localhost:3000/join/${hostRoomCode}`, { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));
    await pageB.evaluate(() => document.getElementById('btn-connect').click());

    console.log('Waiting for initial P2P connection...');
    await waitForP2PConnection(pageA, pageB, 15);
    console.log('✓ Both devices connected in P2P mode!');

    // Exchange test message
    await pageA.evaluate(() => document.getElementById('btn-send-hello').click());
    await new Promise(r => setTimeout(r, 400));
    const bReceivedMsg = await pageB.evaluate(() => {
      const el = document.querySelector('#test-chat-log');
      return el ? el.textContent : '';
    });
    assert(bReceivedMsg.includes('Hello World'), 'Device B should receive message from Device A');
    console.log('✓ P2P data exchange verified!\n');

    // ---------------------------------------------------------------
    // TEST 3: HOST REFRESHES WHILE CONNECTED -> AUTO RECONNECT
    // ---------------------------------------------------------------
    console.log('--- TEST 3: Host Refreshes Page While Connected ---');
    console.log('Host refreshing page...');
    await pageA.reload({ waitUntil: 'networkidle0' });

    console.log('Waiting for automatic P2P reconnection after Host reload...');
    await waitForP2PConnection(pageA, pageB, 20);
    console.log('✓ Host and Guest automatically re-established P2P connection!');

    // Verify data channel still sends after host reload
    await pageB.evaluate(() => {
      document.getElementById('test-msg-input').value = 'Reply after host refresh';
      document.getElementById('btn-send-test').click();
    });
    await new Promise(r => setTimeout(r, 500));
    const aReceivedMsg = await pageA.evaluate(() => {
      const el = document.querySelector('#test-chat-log');
      return el ? el.textContent : '';
    });
    assert(aReceivedMsg.includes('Reply after host refresh'), 'Device A should receive message after host refresh');
    console.log('✓ TEST 3 PASSED: Host refresh recovery verified!\n');

    // ---------------------------------------------------------------
    // TEST 4: GUEST REFRESHES WHILE CONNECTED -> AUTO RECONNECT
    // ---------------------------------------------------------------
    console.log('--- TEST 4: Guest Refreshes Page While Connected ---');
    console.log('Guest refreshing page...');
    await pageB.reload({ waitUntil: 'networkidle0' });

    console.log('Waiting for automatic P2P reconnection after Guest reload...');
    await waitForP2PConnection(pageA, pageB, 20);
    console.log('✓ Host and Guest automatically re-established P2P connection!');

    // Verify data channel still sends after guest reload
    await pageA.evaluate(() => document.getElementById('btn-send-hello').click());
    await new Promise(r => setTimeout(r, 500));
    const bReceivedMsg2 = await pageB.evaluate(() => {
      const el = document.querySelector('#test-chat-log');
      return el ? el.textContent : '';
    });
    assert(bReceivedMsg2.includes('Hello World'), 'Device B should receive message after guest refresh');
    console.log('✓ TEST 4 PASSED: Guest refresh recovery verified!\n');

    // ---------------------------------------------------------------
    // TEST 5: EXPLICIT DISCONNECT PURGES SESSION
    // ---------------------------------------------------------------
    console.log('--- TEST 5: Explicit Disconnect Purges Session ---');
    await pageA.evaluate(() => document.getElementById('btn-disconnect').click());
    await new Promise(r => setTimeout(r, 500));

    // Verify Device A is on idle and sessionStorage is cleared
    const aSession = await pageA.evaluate(() => sessionStorage.getItem('peerdrop_session'));
    assert.strictEqual(aSession, null, 'Device A session should be purged on disconnect');
    assert(pageA.url().endsWith(':3000/'), 'Device A URL should be root /');

    // Device A reloads: should remain cleanly on Idle view
    await pageA.reload({ waitUntil: 'networkidle0' });
    const aIdleAfterReload = await pageA.evaluate(() => document.getElementById('view-idle').classList.contains('active'));
    assert(aIdleAfterReload, 'Device A should stay on Idle screen after disconnect + reload');
    console.log('✓ TEST 5 PASSED: Disconnect cleanly purges session!\n');

    // ---------------------------------------------------------------
    // TEST 6: BROWSER BACK / FORWARD NAVIGATION (POPSTATE)
    // ---------------------------------------------------------------
    console.log('--- TEST 6: Browser Back / Forward History Navigation ---');
    await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 300));
    await pageA.evaluate(() => document.getElementById('btn-create-room').click());

    // Wait for room creation
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 200));
      const code = await pageA.evaluate(() => document.querySelector('#display-room-code')?.textContent.trim());
      if (code && code !== '------') break;
    }
    assert(pageA.url().includes('/join/'), 'URL should have changed to /join/CODE');

    // Press browser Back button
    console.log('Navigating browser back...');
    await pageA.goBack({ waitUntil: 'networkidle0' });
    await new Promise(r => setTimeout(r, 500));

    const aIsIdle = await pageA.evaluate(() => document.getElementById('view-idle').classList.contains('active'));
    assert(aIsIdle, 'Navigating back should return to Idle view');
    console.log('✓ TEST 6 PASSED: Browser popstate history navigation verified!\n');

    console.log('======================================================');
    console.log('   ALL REFRESH RECOVERY TESTS PASSED (100%)           ');
    console.log('======================================================\n');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runPageRefreshRecoveryTests();
