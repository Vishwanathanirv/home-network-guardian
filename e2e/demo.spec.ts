import { expect, test, type Page } from "@playwright/test";

const onPlan = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name},`) });
const details = (page: Page) => page.getByRole("region", { name: "Details" });

// Every flow runs under the production Content-Security-Policy (the preview server sends
// vercel.json's headers); anything it blocks fails the test.
const blocked = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, info) => {
  const list: string[] = [];
  blocked.set(page, list);
  page.on("console", (m) => /Content.Security.Policy|Refused to/i.test(m.text()) && list.push(m.text()));
  // Returning visitors have seen the first-visit briefing; it has its own tests below.
  if (!info.title.startsWith("first visit")) await page.addInitScript(() => localStorage.setItem("lamplight-briefed", "1"));
});
test.afterEach(({ page }) => expect(blocked.get(page) ?? []).toEqual([]));

test("first visit: the idea, then tonight's worst problem in one click", async ({ page }) => {
  await page.goto("/");
  const briefing = page.getByRole("dialog", { name: /which one to fix tonight/ });
  await expect(briefing).toBeVisible();
  await expect(briefing.getByRole("button", { name: "Show me tonight's worst problem →" })).toBeFocused();
  await briefing.getByRole("button", { name: "Show me tonight's worst problem →" }).click();
  await expect(briefing).toBeHidden();
  await expect(page).toHaveURL(/\?device=/);
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("how it works follows one device from this scan through every step", async ({ page }) => {
  await page.goto("/how");
  const steps = page.getByRole("list", { name: "Steps" });
  await expect(page.getByText(/^Found at /).first()).toBeVisible();
  await steps.getByRole("button", { name: /Working out what each one is/ }).click();
  await expect(page.getByText(/made by|a guess|likely|sure/).first()).toBeVisible();
  await steps.getByRole("button", { name: /Deciding what matters/ }).click();
  await steps.getByRole("button", { name: /Proving the worst ones/ }).click();
  await page.getByRole("button", { name: "Open this device →" }).click();
  await expect(page).toHaveURL(/\?device=/);
});

test("the site is served with strict security headers", async ({ page }) => {
  const r = await page.goto("/");
  const h = r!.headers();
  expect(h["content-security-policy"]).toContain("script-src 'self'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
});

test("the example home fills the screen and lists what to fix tonight", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /17 devices are home\. 6 need you tonight\. 2 are new\./ })).toBeVisible();
  await page.getByRole("button", { name: "House plan", exact: true }).click();
  await expect(onPlan(page, "Living Room TV")).toBeVisible();
  await expect(details(page).getByText("Android debugging is open to the network")).toBeVisible();

  // Ticking a problem off updates the headline and the device's badge on the plan.
  await details(page).getByRole("button", { name: "Done: Android debugging is open to the network" }).click();
  await expect(page.getByRole("heading", { name: /5 need you tonight/ })).toBeVisible();
  // Each fix lights one lamp in the string.
  const lamps = page.getByRole("progressbar", { name: "Problems fixed" });
  await expect(lamps).toHaveAttribute("aria-valuenow", "1");
  await expect(lamps.locator(".lamp.lit")).toHaveCount(1);
  await expect(onPlan(page, "Living Room TV")).toHaveAttribute("aria-label", /fine/);
});

test("tapping a device on the plan opens it, and it can be renamed and moved", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "House plan", exact: true }).click();
  await onPlan(page, "Living Room TV").click();
  await expect(details(page).getByRole("heading", { name: "Living Room TV", exact: true })).toBeVisible();
  // Its Bonjour service and model are shown.
  await expect(details(page).getByText("Google Cast", { exact: true })).toBeVisible();
  await details(page).getByRole("tab", { name: /Fix/ }).click();
  await expect(details(page).getByText("Developer options").first()).toBeVisible();
  await details(page).getByRole("tab", { name: "History" }).click();
  await expect(details(page).getByText("Not on the network.")).toBeVisible();

  await page.goto("/?device=192.168.1.31");
  await expect(page.getByText("Shenzhen Bilian Electronic")).toBeVisible();
  await expect(page.getByText("Telnet is open").first()).toBeVisible();
  await page.getByLabel("Call it").fill("Baby monitor");
  await page.getByLabel("Call it").press("Enter");
  await page.getByRole("combobox", { name: "Room" }).selectOption("kids");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Baby monitor" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Room" })).toHaveValue("kids");
});

test("search and filters narrow the plan to matching devices", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /devices are home/ })).toBeVisible();
  await page.keyboard.press("/");
  await page.keyboard.type("camera");
  await expect(details(page).getByRole("heading", { name: "2 devices" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Needs you tonight" }).click();
  await expect(details(page).getByRole("heading", { name: "4 devices" })).toBeVisible();
  await details(page).getByRole("button", { name: /^Living Room TV/ }).click();
  await expect(details(page).getByRole("heading", { name: "Living Room TV", exact: true })).toBeVisible();
});

test("a pasted ARP table becomes the current scan", async ({ page }) => {
  await page.goto("/scans");
  await page.getByLabel("Scan contents").fill("router.home (192.168.0.1) at 50:c7:bf:3a:91:e on en0 ifscope [ethernet]\n? (192.168.0.23) at 54:9c:6a:11:e7:40 on en0 ifscope [ethernet]");
  await page.getByRole("button", { name: "Show it on the plan" }).click();
  await expect(page.getByRole("heading", { name: /^2 devices are home/ })).toBeVisible();
  await page.goto("/scans");
  await page.getByLabel("Scan contents").fill("hello");
  await page.getByRole("button", { name: "Show it on the plan" }).click();
  await expect(page.getByRole("alert")).toContainText("arp -a");
});

test("what changed lists who joined since last week", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /What changed/ }).click();
  await expect(page.getByText("Joined the network").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Living Room TV" })).toBeVisible();
  await expect(page.getByText("Started answering on File transfer (FTP)")).toBeVisible();
});

test("the network page grades the whole home, and the scan page has the commands", async ({ page }) => {
  await page.goto("/network");
  await expect(details(page).getByText(/Safety grade [A-F]/)).toBeVisible();
  await expect(details(page).getByText("Archer C6 v2 by TP-Link", { exact: false })).toBeVisible();
  // The way out is one beam of light: you, the router, the internet, each stretch with its speed.
  const beam = details(page).getByRole("list", { name: "How fast the way out of your home is" });
  await expect(beam.getByText("Router to the internet:")).toBeAttached();
  await expect(beam).toContainText("2.1 ms");
  await expect(beam).toContainText("18.4 ms");
  await expect(details(page).getByText(/17\s*lights are on in this home/)).toBeVisible();
  const download = page.waitForEvent("download");
  await details(page).getByRole("button", { name: "Download the report" }).click();
  expect((await download).suggestedFilename()).toMatch(/^lamplight-report-.*\.md$/);

  await page.goto("/scans");
  await page.getByRole("tab", { name: "Windows" }).click();
  // Pasting two lines leads, because Windows Smart App Control can block a downloaded launcher.
  await expect(details(page).getByText(/curl\.exe -L -o lamplight\.cjs/).first()).toBeVisible();
  await expect(details(page).getByText("node lamplight.cjs live").first()).toBeVisible();
  // The launcher is still there as another way, and really downloads.
  const dl = page.waitForEvent("download");
  await details(page).getByRole("button", { name: /Download the Windows launcher/ }).click();
  expect((await dl).suggestedFilename()).toBe("lamplight-windows.cmd");
  // The terminal commands are still there for people who want them.
  await page.getByRole("button", { name: /Prefer to type commands/ }).click();
  // With no address typed, the scan finds your own network by itself; it never guesses one.
  await expect(details(page).getByText("node lamplight.cjs scan", { exact: true }).first()).toBeVisible();
  await expect(details(page).getByText(/--network 192\.168\.1\.0/)).toHaveCount(0);
  await page.getByLabel("Your computer's address").fill("10.101.250.38");
  await expect(details(page).getByText("node lamplight.cjs scan --network 10.101.250.0/24").first()).toBeVisible();
  await expect(details(page).getByText(/curl\.exe -L -o lamplight\.cjs/).first()).toBeVisible();
});

test("live mode: the site reads the scanner on this computer and shows who comes and goes", async ({ page }) => {
  const { DEMO_DETAILS, DEMO_INTERNET, DEMO_XML_TONIGHT, parseNmap, withDetails } = await import("../packages/core/src/index");
  const scan = { ...withDetails(parseNmap(DEMO_XML_TONIGHT), DEMO_DETAILS), source: "lamplight" as const, gateway: "192.168.1.1", internet: DEMO_INTERNET };
  const started = new Date(Date.now() - 20 * 60_000).toISOString();
  const t = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const presence = Object.fromEntries(scan.devices.map((d) => [d.mac!.toUpperCase(), { ip: d.ip, mac: d.mac, online: d.ip !== "192.168.1.11", firstSeen: d.ip === "192.168.1.24" ? t(2) : started, lastSeen: d.ip === "192.168.1.11" ? t(6) : t(0), since: started, misses: 0 }]));
  let calls = 0;
  await page.route("http://127.0.0.1:47114/**", async (route) => {
    const auth = route.request().headers().authorization;
    if (auth !== "Bearer 0123456789abcdef01234567") return route.fulfill({ status: 401, json: { error: "no" } });
    calls++;
    const events = [
      { id: 1, at: t(19), type: "scan", ip: "192.168.1.0/24", detail: "17 devices" },
      { id: 2, at: t(6), type: "away", ip: "192.168.1.11", name: "Ravi's iPhone" },
      ...(calls > 1 ? [{ id: 3, at: t(0), type: "joined", ip: "192.168.1.24", mac: "1C:A4:10:39:6B:E5", name: "Living Room TV" }] : []),
    ];
    const after = Number(new URL(route.request().url()).searchParams.get("after"));
    await route.fulfill({ json: { version: 1, started, network: "192.168.1.0/24", scanning: null, scan, presence, events: events.filter((e) => e.id > after), health: [{ at: t(1), routerMs: 2, internetMs: 19 }, { at: t(0), routerMs: 3, internetMs: 21 }] } });
  });
  await page.goto("/?live=47114&key=0123456789abcdef01234567");
  await expect(page.getByRole("button", { name: "Live: open activity" })).toBeVisible();
  // The key is taken out of the address bar.
  expect(page.url()).not.toContain("key=");
  await expect(page.getByRole("button", { name: /^Ravi's iPhone, .*away/ })).toBeVisible();
  // A device joining pops up, and the activity feed has it.
  await expect(page.getByRole("status").getByText("Joined the network")).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Live: open activity" }).click();
  await expect(details(page).getByText("Went away")).toBeVisible();
  await expect(details(page).getByText(/Internet 21 ms/)).toBeVisible();
});

test("the table view sorts every device, and Ctrl K jumps anywhere", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /devices are home/ })).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.getByRole("region", { name: "All devices" });
  await table.getByRole("button", { name: /^Address/ }).click();
  await expect(table.locator("tbody tr").first()).toContainText("192.168.1.1");
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox", { name: "Go to a device or do something" })).toBeFocused();
  await page.keyboard.type("officejet");
  await page.keyboard.press("Enter");
  await expect(details(page).getByRole("heading", { name: /OfficeJet Pro 9010/ })).toBeVisible();
});

test("in live mode, a camera's snapshot shows right in the app", async ({ page }) => {
  const { DEMO_DETAILS, DEMO_XML_TONIGHT, parseNmap, withDetails } = await import("../packages/core/src/index");
  const scan = { ...withDetails(parseNmap(DEMO_XML_TONIGHT), DEMO_DETAILS), source: "lamplight" as const, gateway: "192.168.1.1" };
  const started = new Date(Date.now() - 600000).toISOString();
  const presence = Object.fromEntries(scan.devices.map((d) => [d.mac!.toUpperCase(), { ip: d.ip, mac: d.mac, online: true, firstSeen: started, lastSeen: new Date().toISOString(), since: started, misses: 0 }]));
  // A 1x1 gif, so the <img> has something real to load.
  const gif = "R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=";
  await page.route("http://127.0.0.1:47114/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/fetch") {
      // The driveway camera answers a snapshot; others 404.
      if (u.searchParams.get("ip") === "192.168.1.30" && u.searchParams.get("path") === "/snapshot.cgi") return route.fulfill({ json: { status: 200, contentType: "image/jpeg", bytes: 40, dataUrl: `data:image/gif;base64,${gif}` } });
      return route.fulfill({ status: 502, json: { error: "no" } });
    }
    await route.fulfill({ json: { version: 1, started, network: "192.168.1.0/24", scanning: null, scan, presence, events: [], health: [] } });
  });
  await page.goto("/?live=47114&key=0123456789abcdef01234567&device=192.168.1.30");
  await details(page).getByRole("tab", { name: "View", exact: true }).click();
  await details(page).getByRole("button", { name: "Try to view this camera" }).click();
  await expect(details(page).getByRole("img", { name: /Snapshot from 192.168.1.30/ })).toBeVisible();
  await expect(details(page).getByText("This camera is open")).toBeVisible();
  // And a device's page can be opened directly on its real address.
  await expect(details(page).getByRole("link", { name: "http://192.168.1.30:80", exact: true })).toHaveAttribute("href", "http://192.168.1.30:80/");
});

test("the universe view draws the network and opens a device, with friendly names", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /devices are home/ })).toBeVisible();
  await page.getByRole("button", { name: "Universe", exact: true }).click();
  await expect(page.getByRole("group", { name: "Your network as an atom" })).toBeVisible();
  // Cheap IoT is named by what it is, not the chip maker.
  await page.getByRole("button", { name: "Table", exact: true }).click();
  const table = page.getByRole("region", { name: "All devices" });
  await expect(table.getByText("Smart home gadget", { exact: false }).first()).toBeVisible();
});

test("the security report lists devices, CVEs and fixes, and opens from the network page", async ({ page }) => {
  await page.goto("/network");
  await details(page).getByRole("button", { name: "Open the full security report" }).click();
  await expect(page.getByRole("heading", { name: "Home network security report" })).toBeVisible();
  await expect(page.getByText(/match a published vulnerability/)).toBeVisible();
  await expect(page.getByText("CVE-2016-7406").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Devices, weakest first" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What to do, most urgent first" })).toBeVisible();
  // A known-vulnerability link points to the public database.
  await expect(page.getByRole("link", { name: /CVE-2016-7406/ }).first()).toHaveAttribute("href", "https://nvd.nist.gov/vuln/detail/CVE-2016-7406");
});
