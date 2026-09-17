import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.join(__dirname, "screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const BROWSER_PATH = fs.existsSync("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
  ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  : "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

async function runMotionTests() {
  console.log("=== PEERDROP: IOS-STYLE MOTION SYSTEM VISUAL TEST ===");
  console.log(`Using browser: ${BROWSER_PATH}`);
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: BROWSER_PATH,
    args: ["--no-sandbox", "--disable-gpu", "--disable-software-rasterizer"],
    protocolTimeout: 60000
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 840, deviceScaleFactor: 2 });

    // 1. Home / Idle state
    console.log("1. Loading Home / Idle view...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0" });
    await page.evaluate(() => localStorage.setItem("peerdrop-theme", "light"));
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 600));

    await page.screenshot({ path: path.join(screenshotsDir, "motion-01-home.png") });
    console.log("   Captured motion-01-home.png");

    // 2. Click "Create Connection" -> Transition to Waiting (staggered entrance)
    console.log("2. Clicking 'Create Connection' (transitioning to Waiting)...");
    await page.evaluate(() => document.getElementById("btn-create-room").click());
    await page.waitForSelector("#view-waiting.active", { timeout: 10000 });
    await page.waitForFunction(() => {
      const el = document.getElementById("display-room-code");
      return el && el.textContent.trim() !== "------";
    }, { timeout: 10000 });

    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(screenshotsDir, "motion-02-waiting-stagger.png") });
    console.log("   Captured motion-02-waiting-stagger.png");

    const roomCode = await page.$eval("#display-room-code", el => el.textContent.trim());
    console.log(`   Host Room Code: ${roomCode}`);

    // 3. Connect Device B to trigger Connecting -> Connected Bloom
    console.log("3. Opening Device B to trigger Connected bloom...");
    const pageB = await browser.newPage();
    await pageB.setViewport({ width: 1280, height: 840, deviceScaleFactor: 2 });
    await pageB.goto(`http://localhost:3000/join/${roomCode}`, { waitUntil: "networkidle0" });
    await pageB.waitForSelector("#btn-connect");
    await pageB.evaluate(() => document.getElementById("btn-connect").click());

    // Wait for Device A to transition to connected
    await page.waitForSelector("#view-connected.active", { timeout: 15000 });
    await page.waitForSelector("#file-drop-zone", { visible: true });
    await new Promise(r => setTimeout(r, 800));

    await page.screenshot({ path: path.join(screenshotsDir, "motion-03-connected-bloom.png") });
    console.log("   Captured motion-03-connected-bloom.png (Light Mode Connected)");

    // 4. Test Theme Switch to Dark Mode on Connected View
    console.log("4. Switching to Dark Mode on Connected View...");
    await page.evaluate(() => document.getElementById("btn-theme-toggle").click());
    await new Promise(r => setTimeout(r, 1400));

    await page.screenshot({ path: path.join(screenshotsDir, "motion-04-connected-dark.png") });
    console.log("   Captured motion-04-connected-dark.png (Dark Mode Connected)");

    // Switch back to light
    console.log("   Switching back to light mode for file transfer...");
    await page.evaluate(() => document.getElementById("btn-theme-toggle").click());
    await new Promise(r => setTimeout(r, 1400));

    // 5. Select File on Device A to verify Card Emerge
    console.log("5. Selecting file on Device A (Card Emerge)...");
    const sampleFilePath = path.join(__dirname, "sample-motion.bin");
    fs.writeFileSync(sampleFilePath, Buffer.alloc(1024 * 1024, 0xAA));

    const fileInput = await page.$("#file-input");
    await fileInput.uploadFile(sampleFilePath);
    await page.waitForSelector("#file-selected-card", { visible: true });
    await new Promise(r => setTimeout(r, 500));

    await page.screenshot({ path: path.join(screenshotsDir, "motion-05-file-selected.png") });
    console.log("   Captured motion-05-file-selected.png");

    // 6. Capture Active Transfer Progress Sheen & Metrics
    console.log("6. Staging active transfer progress card for Progress Sheen...");
    await page.evaluate(() => {
      document.getElementById("file-selected-card").style.display = "none";
      const card = document.getElementById("sender-progress-card");
      card.style.display = "block";
      card.classList.add("card-emerge");
      document.getElementById("sender-file-name").textContent = "sample-motion.bin";
      document.getElementById("sender-percent-text").textContent = "68%";
      document.getElementById("sender-progress-bar").style.width = "68%";
      document.getElementById("sender-transfer-stats").textContent = "696 KB / 1.0 MB";
      document.getElementById("sender-speed").textContent = "18.4 MB/s";
      document.getElementById("sender-eta").textContent = "00:01";
    });
    await new Promise(r => setTimeout(r, 400));

    await page.screenshot({ path: path.join(screenshotsDir, "motion-06-transfer-sheen.png") });
    console.log("   Captured motion-06-transfer-sheen.png");

    // Execute actual WebRTC transfer for end-to-end verification
    console.log("   Executing actual WebRTC transfer...");
    await page.evaluate(() => {
      document.getElementById("sender-progress-card").style.display = "none";
      document.getElementById("file-selected-card").style.display = "block";
      document.getElementById("btn-send-file").click();
    });

    // 7. On Device B, wait for completion to capture iOS Checkmark Pop
    console.log("7. Verifying completion & iOS checkmark pop on Device B...");
    await pageB.waitForSelector("#file-completed-card", { visible: true, timeout: 35000 });
    await new Promise(r => setTimeout(r, 700));

    await pageB.screenshot({ path: path.join(screenshotsDir, "motion-07-completed-pop.png") });
    console.log("   Captured motion-07-completed-pop.png");

    // Cleanup sample file
    if (fs.existsSync(sampleFilePath)) {
      fs.unlinkSync(sampleFilePath);
    }

    console.log("\n=== ALL MOTION SYSTEM TESTS COMPLETED SUCCESSFULLY! ===");
  } finally {
    await browser.close();
  }
}

runMotionTests().catch(err => {
  console.error("Motion test failed:", err);
  process.exit(1);
});
