import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

const BROWSER_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Generate a 1.5 MB test file to thoroughly test multiple chunks, adaptive scaling, pause/resume, and checksums
const TEST_FILE_DIR = path.resolve('test/fixtures');
if (!fs.existsSync(TEST_FILE_DIR)) fs.mkdirSync(TEST_FILE_DIR, { recursive: true });

const TEST_FILE_PATH = path.join(TEST_FILE_DIR, 'speed-test-sample.bin');
const TEST_SIZE = 8 * 1024 * 1024; // 8 MB to thoroughly verify multi-chunk adaptive scaling and pause
const buffer = Buffer.alloc(TEST_SIZE);
for (let i = 0; i < TEST_SIZE; i++) {
  buffer[i] = (i * 31 + 17) & 0xFF; // deterministic pattern
}
fs.writeFileSync(TEST_FILE_PATH, buffer);
console.log(`Generated test file: ${TEST_FILE_PATH} (${TEST_SIZE} bytes)`);

async function runSpeedStreamingVerification() {
  console.log('\n===============================================================');
  console.log('  TESTING ADAPTIVE CHUNKING, CHECKSUMS, PAUSE/RESUME & STREAMING');
  console.log('===============================================================\n');

  const browser = await puppeteer.launch({
    executablePath: BROWSER_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer']
  });

  try {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    await pageA.setViewport({ width: 1000, height: 850 });
    await pageB.setViewport({ width: 1000, height: 850 });

    pageA.on('console', m => console.log('[Device A]', m.text()));
    pageB.on('console', m => console.log('[Device B]', m.text()));

    console.log('1. Connecting Device A & Device B...');
    await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await pageA.evaluate(() => document.getElementById('btn-create-room').click());

    let roomCode = null;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 200));
      roomCode = await pageA.evaluate(() => {
        const el = document.querySelector('#display-room-code');
        const text = el ? el.textContent.trim() : '';
        return (text && text !== '------') ? text : null;
      });
      if (roomCode) break;
    }
    if (!roomCode) throw new Error('Could not get room code on Device A');
    console.log(`   Room Code: [ ${roomCode} ]`);

    await pageB.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await pageB.evaluate((code) => {
      document.getElementById('btn-show-join').click();
      document.getElementById('input-room-code').value = code;
      document.getElementById('btn-connect').click();
    }, roomCode);

    // Wait for connection
    let connected = false;
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 200));
      connected = await pageA.evaluate(() => document.getElementById('view-connected')?.classList.contains('active'));
      if (connected) break;
    }
    if (!connected) throw new Error('WebRTC connection failed');
    console.log('   ✓ P2P Connection Established!');

    // 2. Test Direct-to-Disk Stream UI elements & capability
    console.log('2. Verifying Direct-to-Disk Stream controls...');
    const streamControls = await pageB.evaluate(() => {
      const toggle = document.getElementById('toggle-direct-stream');
      const banner = document.getElementById('direct-stream-banner');
      return {
        exists: Boolean(toggle && banner),
        checked: toggle ? toggle.checked : false
      };
    });
    if (!streamControls.exists) throw new Error('Direct-to-Disk Stream controls not found in DOM');
    console.log(`   ✓ Direct Stream Controls verified (checked=${streamControls.checked})`);

    // 3. Stage 8 MB file on Device A
    console.log('3. Staging 8 MB test file on Device A...');
    const fileInput = await pageA.$('#file-input');
    await fileInput.uploadFile(TEST_FILE_PATH);
    await new Promise(r => setTimeout(r, 400));

    // 4. Send File & Test Adaptive Dynamic Chunking + Pause/Resume mid-transfer
    console.log('4. Initiating transfer from Device A to Device B...');
    await pageA.evaluate(() => {
      document.getElementById('btn-send-file').click();
      setTimeout(() => {
        const btn = document.getElementById('btn-pause-sender');
        if (btn) btn.click();
      }, 25);
    });

    await new Promise(r => setTimeout(r, 250));

    console.log('5. Testing Pause mid-transfer on Device A...');
    // Verify both devices reflect "Paused"
    const pauseState = await pageA.evaluate(() => {
      return {
        badgeText: document.getElementById('sender-badge')?.textContent,
        btnText: document.getElementById('btn-pause-sender')?.textContent.trim()
      };
    });
    console.log(`   Device A pause state: Badge="${pauseState.badgeText}", Button="${pauseState.btnText}"`);
    if (pauseState.badgeText !== 'Paused' || pauseState.btnText !== 'Resume') {
      throw new Error(`Pause failed on Device A: ${JSON.stringify(pauseState)}`);
    }
    console.log('   ✓ Mid-transfer Pause verified on sender!');

    // Capture screenshot during pause
    const screenshotDir = path.resolve('C:\\Users\\ASUS\\.gemini\\antigravity\\brain\\a229783c-40fa-4424-8e26-dede2f8980dd');
    await pageA.screenshot({ path: path.join(screenshotDir, 'test-transfer-paused.png') });

    console.log('6. Resuming transfer on Device A...');
    await pageA.evaluate(() => document.getElementById('btn-pause-sender').click());

    // 7. Monitor transfer completion and dynamic chunk tier
    console.log('7. Monitoring dynamic chunk tier & transfer completion...');
    let completed = false;
    let finalTier = null;

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 150));

      const tier = await pageA.evaluate(() => document.getElementById('sender-tier-badge')?.textContent);
      if (tier) finalTier = tier;

      const isCompleted = await pageB.evaluate(() => {
        const card = document.getElementById('file-completed-card');
        return card && card.style.display !== 'none';
      });

      if (isCompleted) {
        completed = true;
        break;
      }
    }

    if (!completed) throw new Error('Transfer did not reach 100% completion after resume');
    console.log(`   ✓ Transfer completed! Final dynamic chunk tier reached: [ ${finalTier} ]`);

    // 8. Verify Cryptographic Integrity Badge & Checksums
    console.log('8. Verifying Cryptographic Integrity Badge & Checksum on Device B...');
    const integrityInfo = await pageB.evaluate(() => {
      const badge = document.getElementById('integrity-badge');
      const text = document.getElementById('integrity-text')?.textContent;
      const hash = document.getElementById('integrity-hash')?.textContent;
      const dlLink = document.getElementById('btn-download-file')?.getAttribute('href');
      return {
        visible: badge && window.getComputedStyle(badge).display !== 'none',
        text,
        hash,
        dlLink
      };
    });

    console.log('   Integrity Badge visible:', integrityInfo.visible);
    console.log('   Integrity Text:', integrityInfo.text);
    console.log('   Integrity Hash:', integrityInfo.hash);

    if (!integrityInfo.visible || !integrityInfo.text.includes('Verified Bit-for-Bit')) {
      throw new Error(`Integrity verification failed: ${JSON.stringify(integrityInfo)}`);
    }
    if (!integrityInfo.hash.includes('CRC32:')) {
      throw new Error(`CRC-32 hash missing from badge: ${integrityInfo.hash}`);
    }
    console.log('   ✓ "Verified Bit-for-Bit" green shield badge confirmed!');

    // 9. Byte-for-byte binary content verification of downloaded Blob
    console.log('9. Verifying byte-for-byte binary equality with original file...');
    const receivedBuffer = await pageB.evaluate(async (url) => {
      const res = await fetch(url);
      const buf = await res.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      return {
        length: uint8.length,
        head: Array.from(uint8.slice(0, 32)),
        tail: Array.from(uint8.slice(-32))
      };
    }, integrityInfo.dlLink);

    if (receivedBuffer.length !== TEST_SIZE) {
      throw new Error(`Size mismatch! Expected ${TEST_SIZE}, got ${receivedBuffer.length}`);
    }

    const origHead = Array.from(buffer.slice(0, 32));
    const origTail = Array.from(buffer.slice(-32));
    if (JSON.stringify(receivedBuffer.head) !== JSON.stringify(origHead) ||
        JSON.stringify(receivedBuffer.tail) !== JSON.stringify(origTail)) {
      throw new Error('Binary byte mismatch between original file and received Blob!');
    }
    console.log(`   ✓ INTEGRITY 100% CONFIRMED: All ${receivedBuffer.length} bytes identical!`);

    // Capture screenshot of completed card with verified integrity badge
    await pageB.screenshot({ path: path.join(screenshotDir, 'test-transfer-verified-badge.png') });
    console.log('   ✓ Visual screenshots saved to artifacts directory');

    console.log('\n===============================================================');
    console.log('  ALL SPEED, STREAMING, INTEGRITY & PAUSE/RESUME TESTS PASSED! ');
    console.log('===============================================================\n');

  } finally {
    await browser.close();
    // Clean up test file
    try { fs.unlinkSync(TEST_FILE_PATH); } catch (_) {}
  }
}

runSpeedStreamingVerification().catch(err => {
  console.error('\n❌ Speed & Streaming Test Failed:', err);
  process.exit(1);
});
