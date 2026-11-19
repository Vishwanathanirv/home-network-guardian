import http from "node:http";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { fetchResource, lagSpike, startLive } from "../src/live";
import { siteFiles } from "../src/ui";

describe("live mode's local server", () => {
  const live = startLive({ cidr: "10.255.255.0/30", port: 47991, every: 60 });
  afterAll(() => live.stop());
  const base = "http://127.0.0.1:47991";

  it("refuses requests without the key", async () => {
    await live.ready;
    const r = await fetch(`${base}/state`);
    expect(r.status).toBe(401);
  });

  it("answers the site's browser preflight, including private network access", async () => {
    const r = await fetch(`${base}/state`, { method: "OPTIONS", headers: { origin: "https://home-network-guardian.vercel.app", "access-control-request-private-network": "true" } });
    expect(r.status).toBe(204);
    expect(r.headers.get("access-control-allow-private-network")).toBe("true");
    expect(r.headers.get("access-control-allow-origin")).toBe("https://home-network-guardian.vercel.app");
  });

  it("serves the state with the key", async () => {
    const r = await fetch(`${base}/state?after=0`, { headers: { authorization: `Bearer ${live.key}` } });
    expect(r.status).toBe(200);
    const s = await r.json();
    expect(s).toMatchObject({ version: 1, network: "10.255.255.0/30" });
    expect(Array.isArray(s.events)).toBe(true);
  });
});



describe("fetching a page or snapshot from a device", () => {
  let dev: http.Server;
  let port = 0;
  beforeAll(async () => {
    dev = http.createServer((req, res) => {
      if (req.url === "/snap.jpg") {
        res.setHeader("content-type", "image/jpeg");
        return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
      }
      res.setHeader("content-type", "text/html");
      res.setHeader("server", "thttpd/2.25b");
      res.end("<html><head><title>IP Camera</title></head><body>hi</body></html>");
    });
    await new Promise<void>((r) => dev.listen(0, "127.0.0.1", r));
    port = (dev.address() as AddressInfo).port;
  });
  afterAll(() => dev.close());

  it("returns an image as a data URL", async () => {
    const r = await fetchResource(`http://127.0.0.1:${port}/snap.jpg`);
    expect(r?.contentType).toBe("image/jpeg");
    expect(r?.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("returns a page's title and server, as text", async () => {
    const r = await fetchResource(`http://127.0.0.1:${port}/`);
    expect(r).toMatchObject({ status: 200, contentType: "text/html", title: "IP Camera", server: "thttpd/2.25b" });
    expect(r?.text).toContain("<body>");
  });
});

describe("the app built into the scanner", () => {
  const page = "<!doctype html><head><title>Lamplight</title>";
  const site = siteFiles({ "index.html": ["text/html; charset=utf-8", gzipSync(page).toString("base64")], "assets/app.js": ["text/javascript", gzipSync("1").toString("base64")] });
  const live = startLive({ cidr: "10.255.255.0/30", port: 47992, every: 60, site });
  afterAll(() => live.stop());
  const base = "http://127.0.0.1:47992";

  it("serves the app from this computer, and every page of it, carrying this session's key", async () => {
    await live.ready;
    for (const path of ["/", "/network", "/scans"]) {
      const r = await fetch(base + path);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe(page.replace("<head>", `<head><meta name="lamplight-live" content="47992:${live.key}">`));
    }
    expect((await fetch(`${base}/assets/app.js`)).headers.get("content-type")).toBe("text/javascript");
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
  });

  it("serves the site with the same security policy as the hosted app", async () => {
    const { readFileSync } = await import("node:fs");
    const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));
    const hosted = vercel.headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy").value;
    const r = await fetch(`${base}/`);
    expect(r.headers.get("content-security-policy")).toBe(hosted);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
  });

  it("still keeps the scan data behind the key", async () => {
    expect((await fetch(`${base}/state`)).status).toBe(401);
  });

  it("lets only the hosted app, its previews and local pages call the data endpoints from another address", async () => {
    const from = async (origin: string) => (await fetch(`${base}/state`, { headers: { origin } })).headers.get("access-control-allow-origin");
    expect(await from("https://evil.example")).toBeNull();
    expect(await from("https://home-network-guardian.vercel.app")).toBe("https://home-network-guardian.vercel.app");
    expect(await from("https://home-network-guardian-cxcf5mcse-vishwanathanirv-2900.vercel.app")).not.toBeNull();
    // Anyone can make a Vercel project called home-network-guardian-<anything>; that's not us.
    expect(await from("https://home-network-guardian-evil.vercel.app")).toBeNull();
    expect(await from("https://home-network-guardian-x-vishwanathanirv-2900.vercel.app.evil.example")).toBeNull();
  });

  it("never lets another website read the page that carries the key", async () => {
    for (const path of ["/", "/index.html", "/device/1"]) {
      const r = await fetch(`${base}${path}`, { headers: { origin: "https://home-network-guardian.vercel.app" } });
      expect(r.status).toBe(200);
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
    }
    const pre = await fetch(`${base}/`, { method: "OPTIONS", headers: { origin: "https://home-network-guardian.vercel.app", "access-control-request-private-network": "true" } });
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    expect(pre.headers.get("access-control-allow-private-network")).toBeNull();
  });

  it("rejects a key that is wrong, shorter or longer", async () => {
    for (const k of [live.key.slice(0, -1), `${live.key}0`, live.key.replace(/./, (c) => (c === "a" ? "b" : "a")), ""])
      expect((await fetch(`${base}/state`, { headers: { authorization: `Bearer ${k}` } })).status).toBe(401);
    expect((await fetch(`${base}/state`, { headers: { authorization: `Bearer ${live.key}` } })).status).toBe(200);
  });

  it("refuses a page that reached it under another name (DNS rebinding)", async () => {
    const status = await new Promise<number>((done) =>
      http.get({ host: "127.0.0.1", port: 47992, path: "/", headers: { host: "evil.example:47992" } }, (r) => (r.resume(), done(r.statusCode ?? 0))),
    );
    expect(status).toBe(421);
  });
});


describe("spotting a real slowdown", () => {
  const steady = Array.from({ length: 20 }, (_, i) => ({ internetMs: 18 + (i % 4) }));
  it("ignores ordinary wobble", () => {
    expect(lagSpike(steady, 45)).toBeUndefined();
    expect(lagSpike(steady.slice(0, 3), 400)).toBeUndefined(); // too little history to judge
  });
  it("reports a real spike, with what's usual", () => {
    expect(lagSpike([...steady, { internetMs: 260 }], 260)).toEqual({ ms: 260, usual: 20 });
  });
});
