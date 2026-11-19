import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { analyse, checkDevice, classify, compare, DEMO_XML_LAST_WEEK, DEMO_XML_TONIGHT, isRandomMac, parseAny, parseArp, parseNmap, setOui, vendorOf, type Device } from "../src";

beforeAll(() => setOui(JSON.parse(readFileSync(path.join(__dirname, "../data/oui.json"), "utf8"))));

const dev = (over: Partial<Device>): Device => ({ ip: "192.168.1.77", ports: [], ...over });
const tcp = (...ports: number[]) => ports.map((port) => ({ port, proto: "tcp" as const }));
const ids = (d: Device, gw?: string) => checkDevice(d, gw).issues.map((i) => i.id);

describe("reading scans", () => {
  it("reads nmap XML: up hosts, MAC, vendor, open ports, OS and the scan time", () => {
    const s = parseNmap(DEMO_XML_TONIGHT);
    expect(s.devices).toHaveLength(17);
    expect(s.network).toBe("192.168.1.0/24");
    expect(s.at).toBe("2026-11-15T21:40:00.000Z");
    const router = s.devices.find((d) => d.ip === "192.168.1.1")!;
    expect(router.mac).toBe("50:C7:BF:3A:91:0E");
    expect(router.vendor).toBe("TP-LINK");
    expect(router.ports.map((p) => p.port)).toEqual([22, 53, 80, 1900]);
    expect(router.ports[0]).toMatchObject({ product: "Dropbear sshd", version: "2014.63 protocol 2.0" });
  });

  it("skips hosts that are down, closed and filtered ports, and decodes entities", () => {
    const xml = `<?xml version="1.0"?><nmaprun args="nmap 10.0.0.0/24">
      <host><status state="down"/><address addr="10.0.0.9" addrtype="ipv4"/></host>
      <host><status state="up"/><address addr="10.0.0.2" addrtype="ipv4"/><hostnames><hostname name="Tom&apos;s &amp; Co"/></hostnames>
        <ports><port protocol="tcp" portid="22"><state state="filtered"/></port><port protocol="tcp" portid="80"><state state="open"/><service name="http"/></port><port protocol="tcp" portid="81"><state state="closed"/></port></ports></host>
      <!-- a comment with <host> inside --></nmaprun>`;
    const s = parseNmap(xml);
    expect(s.devices).toHaveLength(1);
    expect(s.devices[0].hostname).toBe("Tom's & Co");
    expect(s.devices[0].ports.map((p) => p.port)).toEqual([80]);
  });

  it("reads ARP tables from Windows, macOS and Linux", () => {
    const win = `Interface: 192.168.1.14 --- 0x5\n  Internet Address      Physical Address      Type\n  192.168.1.1           50-c7-bf-3a-91-0e     dynamic\n  192.168.1.255         ff-ff-ff-ff-ff-ff     static\n  224.0.0.22            01-00-5e-00-00-16     static`;
    const mac = `router.home (192.168.1.1) at 50:c7:bf:3a:91:e on en0 ifscope [ethernet]\n? (192.168.1.31) at 54:9c:6a:11:e7:40 on en0 ifscope [ethernet]\n? (192.168.1.99) at (incomplete) on en0 ifscope [ethernet]`;
    const linux = `192.168.1.1 dev wlan0 lladdr 50:c7:bf:3a:91:0e REACHABLE\n192.168.1.40 dev wlan0 lladdr 18:60:24:b3:6d:15 STALE\n192.168.1.50 dev wlan0  FAILED`;
    expect(parseArp(win).devices.map((d) => [d.ip, d.mac])).toEqual([["192.168.1.1", "50:C7:BF:3A:91:0E"]]);
    const m = parseArp(mac).devices;
    expect(m.map((d) => d.mac)).toEqual(["50:C7:BF:3A:91:0E", "54:9C:6A:11:E7:40"]);
    expect(m[0].hostname).toBe("router.home");
    expect(m[1].hostname).toBeUndefined();
    expect(parseArp(linux).devices).toHaveLength(2);
  });

  it("detects the format and explains what's wrong with bad input", () => {
    expect(parseAny(DEMO_XML_LAST_WEEK).source).toBe("nmap");
    expect(parseAny(JSON.stringify({ at: "x", source: "lamplight", devices: [{ ip: "192.168.1.3" }] })).devices[0].ports).toEqual([]);
    expect(() => parseAny("{ nope")).toThrow(/couldn't be read/);
    expect(() => parseAny('{"hello": 1}')).toThrow(/isn't a Lamplight scan/);
    expect(() => parseAny("<html></html>")).toThrow(/isn't nmap XML/);
    expect(() => parseAny("just some words")).toThrow(/arp -a/);
  });
});

describe("knowing what a device is", () => {
  it("looks up vendors from the IEEE registry and spots private MACs", () => {
    expect(vendorOf("B8:27:EB:00:00:01")).toMatch(/Raspberry Pi/);
    expect(vendorOf("00-11-32-aa-bb-cc")).toBe("Synology");
    expect(isRandomMac("DA:71:0E:52:19:B3")).toBe(true);
    expect(isRandomMac("50:C7:BF:3A:91:0E")).toBe(false);
    expect(vendorOf("DA:71:0E:52:19:B3")).toBeUndefined();
  });

  it("combines maker, name and services, and says why", () => {
    expect(classify(dev({ mac: "00:11:32:01:02:03", ports: tcp(5000, 5001, 445) })).kind).toBe("nas");
    expect(classify(dev({ hostname: "Galaxy-S24", mac: "DA:71:0E:52:19:B3" })).kind).toBe("phone");
    const cam = classify(dev({ ports: tcp(80, 554) }));
    expect(cam.kind).toBe("camera");
    expect(cam.why.join(" ")).toMatch(/RTSP/);
    expect(classify(dev({ ip: "192.168.1.1", ports: tcp(80) }), "192.168.1.1")).toMatchObject({ kind: "router", confidence: "sure" });
    expect(classify(dev({})).kind).toBe("unknown");
  });
});

describe("finding problems", () => {
  it("flags Telnet and Android debugging as critical", () => {
    expect(checkDevice(dev({ ports: tcp(23) })).worst).toBe("critical");
    expect(ids(dev({ ports: tcp(5555, 8008) }))).toContain("adb");
  });

  it("knows a few notorious software versions, and is careful about backports", () => {
    const ssh = (version: string) => checkDevice(dev({ ports: [{ port: 22, proto: "tcp", product: "OpenSSH", version }] })).issues.find((i) => i.id === "outdated");
    expect(ssh("9.6p1")?.severity).toBe("high");
    expect(ssh("8.4p1")).toBeUndefined();
    expect(ssh("9.8p1")).toBeUndefined();
    expect(ssh("9.2p1 Debian 2+deb12u2")?.severity).toBe("medium");
    expect(checkDevice(dev({ ports: [{ port: 21, proto: "tcp", product: "vsftpd", version: "2.3.4" }] })).worst).toBe("critical");
    expect(checkDevice(dev({ ports: [{ port: 445, proto: "tcp", product: "Samba smbd", version: "4.5.16" }] })).issues[0].title).toMatch(/SambaCry/);
    expect(checkDevice(dev({ ports: [{ port: 445, proto: "tcp", product: "Samba smbd", version: "4.18.2" }] })).issues.find((i) => i.id === "outdated")).toBeUndefined();
  });

  it("judges by device type: file sharing is normal on a NAS, odd on a gadget", () => {
    expect(ids(dev({ mac: "00:11:32:01:02:03", ports: tcp(445, 5000) }))).not.toContain("smb");
    expect(ids(dev({ ports: tcp(445, 554) }))).toContain("smb");
    expect(ids(dev({ ip: "192.168.1.1", ports: tcp(53, 80, 1900) }), "192.168.1.1")).toEqual(expect.arrayContaining(["upnp", "router-http"]));
  });

  it("finds the problems in the demo home, worst first, plus network advice", () => {
    const r = analyse(parseNmap(DEMO_XML_TONIGHT));
    expect(r.scan.gateway).toBe("192.168.1.1");
    expect(r.issues[0].severity).toBe("critical");
    expect(r.issues.filter((i) => i.severity === "critical").map((i) => i.id).sort()).toEqual(["adb", "telnet"]);
    expect(r.network.map((n) => n.id)).toEqual(["guest-network"]);
    expect(r.devices.find((d) => d.ip === "192.168.1.12")!.issues.map((i) => i.id)).toEqual(["unknown"]);
  });
});

describe("comparing scans", () => {
  it("reports devices that joined and ports that opened", () => {
    const c = compare(parseNmap(DEMO_XML_LAST_WEEK), parseNmap(DEMO_XML_TONIGHT));
    expect(c.filter((x) => x.type === "joined").map((x) => x.device.ip).sort()).toEqual(["192.168.1.12", "192.168.1.24"]);
    expect(c.find((x) => x.type === "opened")).toMatchObject({ device: { ip: "192.168.1.2" }, ports: [21] });
  });

  it("matches devices by MAC when their IP changes, and ignores ports for ARP-only scans", () => {
    const a = parseArp("192.168.1.30 dev eth0 lladdr 18:80:25:6e:03:9c REACHABLE");
    const b = parseArp("192.168.1.33 dev eth0 lladdr 18:80:25:6e:03:9c REACHABLE");
    expect(compare(a, b)).toEqual([{ type: "moved", device: b.devices[0], from: "192.168.1.30" }]);
    expect(compare(b, { ...a, devices: [] })).toEqual([{ type: "left", device: b.devices[0] }]);
  });
});

describe("what devices say about themselves", () => {
  it("uses Bonjour services and the model a device reports", () => {
    expect(classify(dev({ details: { services: ["_googlecast._tcp"], model: "Chromecast" } })).kind).toBe("tv");
    expect(classify(dev({ details: { services: ["_ipp._tcp", "_uscan._tcp"] } })).kind).toBe("printer");
    expect(classify(dev({ details: { netbios: { name: "RAVI-LAPTOP" } } })).kind).toBe("computer");
  });

  it("flags an expired certificate and a login page without encryption", () => {
    const d = dev({ ports: tcp(5000, 5001), details: { web: [{ port: 5000, login: true, title: "Admin" }], tls: [{ port: 5001, expires: "2020-01-01T00:00:00Z" }] } });
    expect(ids(d)).toEqual(expect.arrayContaining(["cert-expired", "login-http"]));
  });

  it("doesn't ask what a device is when it told us its name", () => {
    expect(ids(dev({ mac: "DA:71:0E:52:19:B3", details: { name: "Living Room TV" } }))).not.toContain("unknown");
  });
});

describe("the connection to the internet", () => {
  const scan = (internet: Parameters<typeof analyse>[0]["internet"]) => analyse({ at: "2026-11-15T00:00:00Z", source: "lamplight", gateway: "192.168.1.1", devices: [dev({ ip: "192.168.1.31", ports: tcp(80, 554) })], internet });
  it("puts a door to the internet on the device it leads to, worse for risky services", () => {
    const r = scan({ externalIp: "203.0.113.42", mappings: [{ protocol: "TCP", externalPort: 10554, internalPort: 554, client: "192.168.1.31" }] });
    expect(r.devices[0].issues[0]).toMatchObject({ id: "upnp-mapping", severity: "critical" });
  });
  it("is calmer behind carrier-grade NAT, and flags DNS that makes up answers", () => {
    const r = scan({ externalIp: "100.72.10.4", nxdomainHijack: true, mappings: [{ protocol: "TCP", externalPort: 10554, internalPort: 554, client: "192.168.1.31" }] });
    expect(r.devices[0].issues.find((i) => i.id === "upnp-mapping")?.severity).toBe("low");
    expect(r.network.map((i) => i.id)).toContain("dns-hijack");
  });
});

describe("known-vulnerability (CVE) matches from version banners", () => {
  const issue = (port: { port: number; proto: "tcp"; product?: string; version?: string }) => checkDevice(dev({ ports: [port] })).issues.find((i) => i.id === "outdated");
  it("flags old Dropbear, Heartbleed and a vulnerable camera web server, each with its CVE", () => {
    expect(issue({ port: 22, proto: "tcp", product: "Dropbear sshd", version: "2014.63" })?.cve).toBe("CVE-2016-7406");
    expect(issue({ port: 443, proto: "tcp", product: "OpenSSL", version: "1.0.1f" })?.cve).toBe("CVE-2014-0160");
    expect(issue({ port: 80, proto: "tcp", product: "GoAhead-Webs", version: "2.5" })?.cve).toBe("CVE-2017-17562");
  });
  it("does not flag a patched-range version", () => {
    expect(issue({ port: 22, proto: "tcp", product: "Dropbear sshd", version: "2020.81" })).toBeUndefined();
  });
});

describe("scan files from elsewhere can't smuggle in a fake address", () => {
  it("only treats real private IPv4 addresses as private", async () => {
    const { isPrivate, isIp } = await import("../src");
    expect(isPrivate("192.168.1.10")).toBe(true);
    expect(isPrivate("10.0.0.1")).toBe(true);
    expect(isPrivate("10.evil.example")).toBe(false);
    expect(isPrivate("192.168.1.10@evil.example")).toBe(false);
    expect(isPrivate("192.168.1.300")).toBe(false);
    expect(isPrivate("8.8.8.8")).toBe(false);
    expect(isIp("fe80::1")).toBe(true);
    expect(isIp("evil.example/x")).toBe(false);
  });

  it("drops devices whose address isn't an IP address", () => {
    const j = JSON.stringify({ devices: [{ ip: "192.168.1.5", ports: [] }, { ip: "evil.example", ports: [] }, { ip: "192.168.1.6/x", ports: [] }] });
    expect(parseAny(j).devices.map((d) => d.ip)).toEqual(["192.168.1.5"]);
    const xml = `<nmaprun><host><status state="up"/><address addr="phish.example" addrtype="ipv4"/></host><host><status state="up"/><address addr="192.168.1.9" addrtype="ipv4"/></host></nmaprun>`;
    expect(parseNmap(xml).devices.map((d) => d.ip)).toEqual(["192.168.1.9"]);
  });
});
