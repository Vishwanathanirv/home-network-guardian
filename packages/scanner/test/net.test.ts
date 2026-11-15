import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hostsIn, probe } from "../src/net";

describe("which addresses get scanned", () => {
  it("lists the hosts in a private network", () => {
    const h = hostsIn("192.168.1.0/24");
    expect(h).toHaveLength(254);
    expect(h[0]).toBe("192.168.1.1");
    expect(h.at(-1)).toBe("192.168.1.254");
    expect(hostsIn("10.0.0.17/30")).toEqual(["10.0.0.17", "10.0.0.18"]);
  });

  it("refuses public addresses and huge ranges", () => {
    expect(() => hostsIn("8.8.8.0/24")).toThrow(/only scans private/);
    expect(() => hostsIn("10.0.0.0/8")).toThrow(/between \/22/);
    expect(() => hostsIn("192.168.1.1")).toThrow(/isn't a network/);
  });
});

describe("probing a port", () => {
  let banner: net.Server;
  let web: http.Server;
  let closedPort = 0;
  beforeAll(async () => {
    banner = net.createServer((s) => {
      s.on("error", () => {});
      s.end("\xff\xfb\x01SSH-2.0-dropbear_2014.63\r\n");
    });
    web = http.createServer((_, res) => {
      res.setHeader("Server", "Hikvision-Webs");
      res.end("ok");
    });
    await new Promise<void>((r) => banner.listen(0, "127.0.0.1", r));
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    const tmp = net.createServer();
    await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
    closedPort = (tmp.address() as net.AddressInfo).port;
    await new Promise((r) => tmp.close(r));
  });
  afterAll(() => {
    banner.close();
    web.close();
  });

  it("reads the first line a service sends, without control bytes", async () => {
    const r = await probe("127.0.0.1", (banner.address() as net.AddressInfo).port, 800, "banner");
    expect(r).toEqual({ state: "open", banner: "SSH-2.0-dropbear_2014.63" });
  });

  it("reads the Server header from a web page", async () => {
    const r = await probe("127.0.0.1", (web.address() as net.AddressInfo).port, 800, "http");
    expect(r).toEqual({ state: "open", banner: "Hikvision-Webs" });
  });

  it("reports a refused connection, which still proves the host is there", async () => {
    expect((await probe("127.0.0.1", closedPort)).state).toBe("refused");
  });
});
