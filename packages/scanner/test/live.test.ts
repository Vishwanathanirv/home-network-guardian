import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startLive } from "../src/live";

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

import http from "node:http";
import type { AddressInfo } from "node:net";
import { fetchResource } from "../src/live";

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
