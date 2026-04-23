const fs = require("fs");
const path = require("path");
const { chromium } = require("./node_modules/.pnpm/@playwright+test@1.59.1/node_modules/@playwright/test/index.js");

const outputDir = path.join(process.cwd(), ".tmp-playwright-review");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function saveScreenshot(page, name) {
  ensureDir(outputDir);
  const filePath = path.join(outputDir, name);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function main() {
  ensureDir(outputDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
  });
  const page = await context.newPage();

  const findings = [];

  await page.goto("http://127.0.0.1:3001/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /sign in to the qa dashboard/i }).waitFor({ timeout: 30000 });
  findings.push({
    page: "login",
    url: page.url(),
    title: await page.title(),
    screenshot: await saveScreenshot(page, "01-login-desktop.png"),
  });

  await page.getByLabel("Email").fill("qa@starhhc.local");
  await page.getByLabel("Password").fill("star1234");
  await Promise.all([
    page.waitForURL(/select-agency|agency/, { timeout: 30000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  findings.push({
    page: "post-login",
    url: page.url(),
    screenshot: await saveScreenshot(page, "02-post-login-desktop.png"),
  });

  if (page.url().includes("/select-agency")) {
    const firstAgencyButton = page.getByRole("button", { name: "Load Agency" }).first();
    await Promise.all([
      page.waitForURL(/agency/, { timeout: 30000 }),
      firstAgencyButton.click(),
    ]);
  }

  await page.getByRole("heading", { name: /agency qa workspace|select an agency/i }).first().waitFor({ timeout: 30000 });

  findings.push({
    page: "agency",
    url: page.url(),
    screenshot: await saveScreenshot(page, "03-agency-desktop.png"),
    bodyTextSnippet: (await page.locator("body").innerText()).slice(0, 2000),
  });

  const patientLink = page.getByRole("link", { name: /open patient/i }).first();
  if (await patientLink.count()) {
    await Promise.all([
      page.waitForURL(/runs\/.+\/patients\/.+/, { timeout: 30000 }),
      patientLink.click(),
    ]);

    findings.push({
      page: "patient-detail",
      url: page.url(),
      screenshot: await saveScreenshot(page, "04-patient-detail-desktop.png"),
      bodyTextSnippet: (await page.locator("body").innerText()).slice(0, 3000),
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  findings.push({
    page: "current-mobile",
    url: page.url(),
    screenshot: await saveScreenshot(page, "05-current-mobile.png"),
    bodyTextSnippet: (await page.locator("body").innerText()).slice(0, 2000),
  });

  const reportPath = path.join(outputDir, "findings.json");
  fs.writeFileSync(reportPath, JSON.stringify(findings, null, 2));
  console.log(JSON.stringify({ outputDir, reportPath, findings }, null, 2));

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
