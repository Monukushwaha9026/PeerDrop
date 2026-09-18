// test/test-chat-upgrade-e2e.mjs
// Comprehensive End-to-End Verification of Wide-Screen Split Layout, Mobile Tabs & Chat Engine
import puppeteer from 'puppeteer-core';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

async function runChatUpgradeE2ETest() {
  console.log('======================================================');
  console.log('    PEERDROP CHAT & WIDE-SCREEN E2E VERIFICATION      ');
  console.log('======================================================\n');

  const browserA = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--use-fake-ui-for-media-stream', '--no-sandbox', '--disable-setuid-sandbox']
  });

  const browserB = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--use-fake-ui-for-media-stream', '--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const pageA = await browserA.newPage();
    const pageB = await browserB.newPage();

    // 1. Configure Viewports: Desktop for A, Mobile for B
    await pageA.setViewport({ width: 1280, height: 800 });
    await pageB.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });

    console.log('1. Setting up Device A (Desktop 1280x800) and Device B (iPhone 390x844)...');

    await pageA.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
    await pageB.goto('http://localhost:3000', { waitUntil: 'networkidle0' });

    // 2. Device A creates connection
    console.log('2. Device A clicks Create Connection...');
    await pageA.evaluate(() => document.getElementById('btn-create-room').click());

    await pageA.waitForFunction(() => {
      const el = document.getElementById('display-room-code');
      return el && el.textContent.trim() !== '' && el.textContent.trim() !== '------';
    }, { timeout: 10000 });

    const roomCode = await pageA.evaluate(() => document.getElementById('display-room-code').textContent.trim());
    console.log(`   Room Code: [ ${roomCode} ]`);

    // 3. Device B joins room
    console.log('3. Device B joins room via room code...');
    await pageB.evaluate(() => document.getElementById('btn-show-join').click());
    await pageB.waitForSelector('#input-room-code', { visible: true });

    await pageB.evaluate((code) => {
      const input = document.getElementById('input-room-code');
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('btn-connect').click();
    }, roomCode);

    // 4. Wait for both devices to enter connected state
    console.log('4. Waiting for WebRTC connection...');
    await Promise.all([
      pageA.waitForSelector('#view-connected.active', { timeout: 15000 }),
      pageB.waitForSelector('#view-connected.active', { timeout: 15000 })
    ]);
    console.log('   ✓ Both devices in Connected state!');

    // Wait for layout animation
    await new Promise(r => setTimeout(r, 600));

    // 5. Verify Desktop Wide Mode on Device A
    console.log('5. Verifying Desktop Wide Layout on Device A...');
    const desktopCheck = await pageA.evaluate(() => {
      const container = document.querySelector('.app-container');
      const filesPane = document.getElementById('pane-files');
      const chatPane = document.getElementById('pane-chat');
      const segmented = document.getElementById('mobile-segmented-control');
      const isContainerConnected = container.classList.contains('is-connected');
      
      const filesVisible = filesPane && window.getComputedStyle(filesPane).display !== 'none';
      const chatVisible = chatPane && window.getComputedStyle(chatPane).display !== 'none';
      const segmentedHidden = segmented && window.getComputedStyle(segmented).display === 'none';

      return { isContainerConnected, filesVisible, chatVisible, segmentedHidden };
    });

    if (!desktopCheck.isContainerConnected || !desktopCheck.filesVisible || !desktopCheck.chatVisible || !desktopCheck.segmentedHidden) {
      throw new Error(`Desktop check failed: ${JSON.stringify(desktopCheck)}`);
    }
    console.log('   ✓ Desktop: Wide card active, side-by-side Dual-Pane visible, tabs hidden!');

    // 6. Verify Mobile Segmented Tabs on Device B
    console.log('6. Verifying Mobile Segmented Tabs on Device B...');
    const mobileCheck = await pageB.evaluate(() => {
      const filesPane = document.getElementById('pane-files');
      const chatPane = document.getElementById('pane-chat');
      const segmented = document.getElementById('mobile-segmented-control');

      const filesVisible = filesPane && window.getComputedStyle(filesPane).display !== 'none';
      const chatHidden = chatPane && window.getComputedStyle(chatPane).display === 'none';
      const segmentedVisible = segmented && window.getComputedStyle(segmented).display === 'flex';

      return { filesVisible, chatHidden, segmentedVisible };
    });

    if (!mobileCheck.filesVisible || !mobileCheck.chatHidden || !mobileCheck.segmentedVisible) {
      throw new Error(`Mobile check failed: ${JSON.stringify(mobileCheck)}`);
    }
    console.log('   ✓ Mobile: Segmented control visible, Files tab active, Chat pane hidden!');

    // 7. Device A sends text message to Device B (testing Delivery check & unread badge)
    console.log('7. Device A sends message to Device B...');
    const testMsg = 'Hello from Desktop to Mobile!';
    await pageA.evaluate((msg) => {
      const input = document.getElementById('test-msg-input');
      input.value = msg;
      document.getElementById('btn-send-test').click();
    }, testMsg);

    // Verify unread badge on Device B (since Device B is on Files tab)
    await pageB.waitForFunction(() => {
      const badge = document.getElementById('chat-unread-badge');
      return badge && badge.style.display !== 'none' && badge.textContent === '1';
    }, { timeout: 8000 });
    console.log('   ✓ Device B shows unread badge: [ 1 ] on Chat tab!');

    // Verify ACK checkmark on Device A
    await pageA.waitForFunction(() => {
      const statuses = Array.from(document.querySelectorAll('.bubble-status'));
      return statuses.some(s => s.textContent === '✓✓');
    }, { timeout: 8000 });
    console.log('   ✓ Device A shows delivery confirmation: [ ✓✓ ]');

    // 8. Device B switches to Chat tab
    console.log('8. Device B switches to Chat tab...');
    await pageB.evaluate(() => document.getElementById('tab-btn-chat').click());
    await new Promise(r => setTimeout(r, 300));

    const mobileChatActive = await pageB.evaluate(() => {
      const chatPane = document.getElementById('pane-chat');
      const badge = document.getElementById('chat-unread-badge');
      const chatText = document.getElementById('test-chat-log')?.innerText || '';
      return {
        chatVisible: window.getComputedStyle(chatPane).display !== 'none',
        badgeHidden: badge.style.display === 'none',
        hasMessage: chatText.includes('Hello from Desktop to Mobile!')
      };
    });

    if (!mobileChatActive.chatVisible || !mobileChatActive.badgeHidden || !mobileChatActive.hasMessage) {
      throw new Error(`Mobile chat activation failed: ${JSON.stringify(mobileChatActive)}`);
    }
    console.log('   ✓ Device B: Chat pane opened, badge cleared, message verified!');

    // 9. Typing Indicator: Device B types in chat
    console.log('9. Device B triggers typing indicator...');
    await pageB.evaluate(() => {
      const input = document.getElementById('test-msg-input');
      input.value = 'Typing something...';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await pageA.waitForFunction(() => {
      const el = document.getElementById('typing-indicator');
      return el && el.style.display !== 'none';
    }, { timeout: 5000 });
    console.log('   ✓ Device A displays live: "Peer is typing..."');

    // 10. Device B clicks quick chip
    console.log('10. Device B sends quick response chip [ Got it! 👍 ]...');
    await pageB.evaluate(() => {
      const chip = Array.from(document.querySelectorAll('.quick-chip')).find(c => c.textContent.includes('Got it'));
      if (chip) chip.click();
    });

    await pageA.waitForFunction(() => {
      const log = document.getElementById('test-chat-log')?.innerText || '';
      return log.includes('Got it! 👍');
    }, { timeout: 6000 });
    console.log('   ✓ Device A received quick chip message: "Got it! 👍"');

    // 11. URL Auto-Linking: Device A sends URL
    console.log('11. Testing clickable URL auto-linker...');
    await pageA.evaluate(() => {
      const input = document.getElementById('test-msg-input');
      input.value = 'Visit repo at https://github.com/Monukushwaha9026/PeerDrop';
      document.getElementById('btn-send-test').click();
    });

    await pageB.waitForFunction(() => {
      const links = Array.from(document.querySelectorAll('.chat-link'));
      return links.some(l => l.href.includes('github.com/Monukushwaha9026/PeerDrop'));
    }, { timeout: 6000 });
    console.log('   ✓ Device B rendered clickable <a> tag for URL!');

    // Capture screenshots with active messages
    await pageA.screenshot({ path: path.join(__dirname, 'screenshots/test-chat-desktop-wide.png') });
    await pageB.screenshot({ path: path.join(__dirname, 'screenshots/test-chat-mobile-tabs.png') });
    console.log('   ✓ Active chat screenshots captured!');

    // 12. Clear Chat
    console.log('12. Testing Clear Chat functionality...');
    await pageA.evaluate(() => document.getElementById('btn-clear-chat').click());
    await new Promise(r => setTimeout(r, 400));

    const clearedCheck = await pageB.evaluate(() => {
      const bubbles = document.querySelectorAll('.chat-bubble');
      return bubbles.length === 0;
    });

    if (!clearedCheck) {
      throw new Error('Chat bubbles were not cleared properly.');
    }
    console.log('   ✓ Chat history wiped cleanly on both peers!');

    console.log('\n======================================================');
    console.log('   ALL CHAT & WIDE-SCREEN UPGRADE TESTS PASSED (100%) ');
    console.log('======================================================\n');

  } finally {
    await browserA.close();
    await browserB.close();
  }
}

runChatUpgradeE2ETest().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
