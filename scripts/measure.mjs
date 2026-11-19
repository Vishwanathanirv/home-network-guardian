/* global process, console, performance */
// Measures the demo build in a real browser: bytes on first load, first paint, and time until
// the home headline is on screen. Run against `vite preview` (npm run measure).
// Usage: node scripts/measure.mjs [url] [runs]
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4333/";
const runs = Number(process.argv[3] ?? 5);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const browser = await chromium.launch();
const out = { cold: [], throttled: [] };
for (const mode of ["cold", "throttled"]) {
  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    if (mode === "throttled") await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    let bytes = 0;
    const byType = {};
    cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
    cdp.on("Network.responseReceived", (e) => (byType[e.requestId] = e.response.url.split("/").pop()));
    const t0 = Date.now();
    await page.goto(url);
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    const ready = Date.now() - t0;
    await page.waitForLoadState("networkidle");
    const fcp = await page.evaluate(() => performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1);
    out[mode].push({ ready, fcp: Math.round(fcp), kb: Math.round(bytes / 1024) });
    await ctx.close();
  }
}
await browser.close();
for (const [mode, rs] of Object.entries(out))
  console.log(`${mode.padEnd(9)} median of ${rs.length}: first paint ${median(rs.map((r) => r.fcp))} ms, headline ready ${median(rs.map((r) => r.ready))} ms, transferred ${median(rs.map((r) => r.kb))} KB`);
