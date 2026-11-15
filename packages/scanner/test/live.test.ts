import { afterAll, describe, expect, it } from "vitest";
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
