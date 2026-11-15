import { expect, test } from "@playwright/test";

test("the example home shows every device and puts the urgent ones first", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /17 devices are home\. 4 need you tonight\. 2 are new\./ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^android-tv-b/ })).toBeVisible();
  const first = page.locator("aside li").first();
  await expect(first).toContainText("Android debugging is open to the network");
  await first.getByRole("button").click();
  await expect(page.getByText("Developer options").first()).toBeVisible();
});

test("a device can be opened, renamed and moved to another room, and that is remembered", async ({ page }) => {
  await page.goto("/?device=192.168.1.31");
  await expect(page.getByText("Shenzhen Bilian Electronic")).toBeVisible();
  await expect(page.getByText("Telnet is open")).toBeVisible();
  await page.getByLabel("Call it").fill("Baby monitor");
  await page.getByLabel("Call it").blur();
  await page.getByRole("combobox", { name: "Room" }).selectOption("kids");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Baby monitor" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Room" })).toHaveValue("kids");
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

test("the changes page lists who joined since last week", async ({ page }) => {
  await page.goto("/changes");
  await expect(page.getByText("Joined the network").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "android-tv-box" })).toBeVisible();
  await expect(page.getByText("Started answering on File transfer (FTP)")).toBeVisible();
});
