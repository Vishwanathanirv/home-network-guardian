import { expect, test, type Page } from "@playwright/test";

const onPlan = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name},`) });
const details = (page: Page) => page.getByRole("region", { name: "Details" });

test("the example home fills the screen and lists what to fix tonight", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /17 devices are home\. 4 need you tonight\. 2 are new\./ })).toBeVisible();
  await expect(onPlan(page, "android-tv-box")).toBeVisible();
  await expect(details(page).getByText("Android debugging is open to the network")).toBeVisible();

  // Ticking a problem off updates the headline and the device's badge on the plan.
  await details(page).getByRole("button", { name: "Done: Android debugging is open to the network" }).click();
  await expect(page.getByRole("heading", { name: /3 need you tonight/ })).toBeVisible();
  await expect(onPlan(page, "android-tv-box")).toHaveAttribute("aria-label", /fine/);
});

test("tapping a device on the plan opens it, and it can be renamed and moved", async ({ page }) => {
  await page.goto("/");
  await onPlan(page, "android-tv-box").click();
  await expect(details(page).getByRole("heading", { name: "android-tv-box" })).toBeVisible();
  await expect(details(page).getByText("Developer options").first()).toBeVisible();

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
  await details(page).getByRole("button", { name: /^router/ }).click();
  await expect(details(page).getByRole("heading", { name: "router" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "android-tv-box" })).toBeVisible();
  await expect(page.getByText("Started answering on File transfer (FTP)")).toBeVisible();
});
