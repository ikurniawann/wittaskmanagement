#!/usr/bin/env node
// Backstage Play render smoke (EPIC-024 T-247). Opt-in: runs only when
// PLAY_SMOKE_URL points at a running app and Playwright + a Chromium build are
// available. Asserts: login works, /play answers 200, the canvas renders, no
// console errors/warnings on /play, draw calls ≤ PLAY_MAX_CALLS (default 300).
//
//   PLAY_SMOKE_URL=http://localhost:3401 PLAY_USER=owner@example.test PLAY_PASS=… \
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright PLAYWRIGHT_CHROMIUM=/path/to/chrome \
//   node scripts/play-smoke.mjs
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const URL_ = process.env.PLAY_SMOKE_URL;
if (!URL_) {
  console.log("[play-smoke] PLAY_SMOKE_URL not set — skipped");
  process.exit(0);
}
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"));
} catch {
  console.log("[play-smoke] playwright not installed — skipped (set PLAYWRIGHT_MODULE to a checkout that has it)");
  process.exit(0);
}
const MAX_CALLS = Number(process.env.PLAY_MAX_CALLS || 300);
const OUT = process.env.PLAY_SMOKE_OUT || "./.play-smoke";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
const logs = [];
page.on("console", (m) => {
  if ((m.type() === "error" || m.type() === "warning") && page.url().includes("/play")) logs.push(`${m.type()}: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => logs.push("pageerror: " + e.message));

await page.goto(`${URL_}/login`, { waitUntil: "load" });
await page.fill('input[name="email"]', process.env.PLAY_USER || "");
await page.fill('input[name="password"]', process.env.PLAY_PASS || "");
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 });

const res = await page.goto(`${URL_}/play`, { waitUntil: "load" });
if (!res || res.status() !== 200) fail(`/play answered ${res?.status()} (is the Play flag on?)`);
await page.waitForSelector("canvas", { timeout: 30000 });
await page.waitForTimeout(6000);
await page.keyboard.press("F3");
await page.waitForTimeout(1200);
const stats = await page.evaluate(() => {
  const els = [...document.querySelectorAll("div")].filter((d) => /calls \d+/.test(d.textContent || ""));
  return els.length ? els[els.length - 1].textContent : "";
});
const calls = Number((/calls (\d+)/.exec(stats || "") || [])[1] || NaN);
await page.screenshot({ path: `${OUT}/play-office.png` });
await browser.close();

console.log(`[play-smoke] ${stats.replace(/\n/g, " · ")}`);
if (!Number.isFinite(calls)) fail("could not read draw calls from the stats overlay");
if (calls > MAX_CALLS) fail(`draw calls ${calls} > ${MAX_CALLS}`);
if (logs.length) fail(`console output on /play:\n${logs.join("\n")}`);
console.log(`[play-smoke] PASS (calls ${calls} ≤ ${MAX_CALLS}, screenshot ${OUT}/play-office.png)`);

function fail(msg) {
  console.error(`[play-smoke] FAIL: ${msg}`);
  process.exit(1);
}
