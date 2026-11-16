import { parseAirport, parseNetsh, parseNmcli } from "../src/wifi";
import { wifiVerdict } from "@lamplight/core";
import http from "node:http";
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mdnsQuery, parseDns, readMdns, readNbstat, readPage } from "../src/discover";
import { hostsIn, pickNetwork, probe, type Iface } from "../src/net";

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
      res.end('<html><head><title>IPCAM  Login</title></head><body><form><input type="password"></form></body></html>');
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
    expect(r).toMatchObject({ state: "open", banner: "SSH-2.0-dropbear_2014.63" });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it("reads the Server header from a web page", async () => {
    const r = await probe("127.0.0.1", (web.address() as net.AddressInfo).port, 800, "http");
    expect(r).toMatchObject({ state: "open", banner: "Hikvision-Webs", web: { status: 200, title: "IPCAM Login", server: "Hikvision-Webs", login: true } });
  });

  it("reports a refused connection, which still proves the host is there", async () => {
    expect((await probe("127.0.0.1", closedPort)).state).toBe("refused");
  });
});

describe("picking the home network", () => {
  const i = (name: string, address: string, extra: Partial<Iface> = {}): Iface => ({ name, address, cidr: `${address.split(".").slice(0, 3).join(".")}.0/24`, virtual: false, gateway: false, ...extra });
  it("prefers the network with the router over VirtualBox's", () => {
    const list = [i("Ethernet 2", "192.168.56.1", { virtual: true }), i("Wi-Fi", "10.101.250.38", { gateway: true })];
    expect(pickNetwork(list)?.cidr).toBe("10.101.250.0/24");
  });
  it("skips virtual adapters when the router is unknown", () => {
    expect(pickNetwork([i("vEthernet (WSL)", "172.20.0.1", { virtual: true }), i("en0", "192.168.1.20")])?.name).toBe("en0");
  });
});

describe("asking devices about themselves", () => {
  // Builds a DNS answer the way a Chromecast sends one.
  function answer(): Buffer {
    const name = (s: string) => Buffer.concat([...s.split(".").map((l) => Buffer.concat([Buffer.from([Buffer.byteLength(l)]), Buffer.from(l)])), Buffer.from([0])]);
    const rr = (n: string, type: number, data: Buffer) => {
      const h = Buffer.alloc(10);
      h.writeUInt16BE(type, 0);
      h.writeUInt16BE(1, 2);
      h.writeUInt32BE(120, 4);
      h.writeUInt16BE(data.length, 8);
      return Buffer.concat([name(n), h, data]);
    };
    const inst = "Living Room TV._googlecast._tcp.local";
    const txt = Buffer.concat(["md=Chromecast", "fn=Living Room TV"].map((t) => Buffer.concat([Buffer.from([t.length]), Buffer.from(t)])));
    const srv = Buffer.concat([Buffer.from([0, 0, 0, 0, 0x1f, 0x49]), name("chromecast-abc.local")]);
    const head = Buffer.alloc(12);
    head.writeUInt16BE(0x8400, 2);
    head.writeUInt16BE(4, 6);
    return Buffer.concat([head, rr("_googlecast._tcp.local", 12, name(inst)), rr(inst, 16, txt), rr(inst, 33, srv), rr("chromecast-abc.local", 1, Buffer.from([192, 168, 1, 24]))]);
  }
  it("reads a Bonjour answer: the name people gave it, its model and services", () => {
    const info = readMdns(parseDns(answer()));
    expect(info).toEqual({ name: "Living Room TV", model: "Chromecast", host: "chromecast-abc", services: ["_googlecast._tcp"] });
  });
  it("writes a valid Bonjour question", () => {
    const q = mdnsQuery(["_ipp._tcp"]);
    expect(q.readUInt16BE(4)).toBe(1);
    expect(q.subarray(12).toString("latin1")).toContain("_ipp");
  });
  it("reads a Windows computer's NetBIOS name and workgroup", () => {
    const b = Buffer.alloc(57 + 36);
    b[56] = 2;
    b.write("RAVI-LAPTOP    ", 57, "latin1");
    b[57 + 15] = 0;
    b.write("WORKGROUP      ", 75, "latin1");
    b[75 + 15] = 0;
    b.writeUInt16BE(0x8000, 75 + 16);
    expect(readNbstat(b)).toEqual({ name: "RAVI-LAPTOP", group: "WORKGROUP" });
  });
  it("notices a login page and reads the title", () => {
    expect(readPage(200, { server: "lighttpd" }, "<title>Router &amp; Wi-Fi</title><input type=password>")).toEqual({ status: 200, title: "Router & Wi-Fi", server: "lighttpd", login: true });
    expect(readPage(401, {}, "")).toMatchObject({ login: true });
  });
});


describe("how the Wi-Fi is locked", () => {
  it("reads Windows, Mac and Linux", () => {
    expect(parseNetsh("    Name                   : Wi-Fi\n    State                  : connected\n    SSID                   : PG-5G\n    Authentication         : WPA2-Personal\n")).toEqual({ ssid: "PG-5G", security: "WPA2-Personal" });
    expect(parseNetsh("    State                  : disconnected\n")).toBeUndefined();
    expect(parseAirport("      Current Network Information:\n        Home:\n          PHY Mode: 802.11ax\n          Security: WPA3 Personal\n      Other Local Wi-Fi Networks:\n")).toEqual({ ssid: "Home", security: "WPA3 Personal" });
    expect(parseNmcli("no:Neighbour:WPA2\nyes:Home:WPA1 WPA2\n")).toEqual({ ssid: "Home", security: "WPA1 WPA2" });
  });
  it("says how strong each lock is", () => {
    expect(wifiVerdict("WPA3 Personal").tone).toBe("ok");
    expect(wifiVerdict("WPA2-Personal").issue?.severity).toBe("info");
    expect(wifiVerdict("WEP").issue?.severity).toBe("critical");
    expect(wifiVerdict("Open").issue?.id).toBe("wifi-open");
    expect(wifiVerdict("WPA-Personal").issue?.severity).toBe("high");
  });
});
