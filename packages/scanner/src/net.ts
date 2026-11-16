import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { promises as dns } from "node:dns";
import net from "node:net";
import os from "node:os";
import { promisify } from "node:util";
import { isPrivate, ipNum, parseArp, type Details, type Device, type Port, type Scan } from "@lamplight/core";
import { askNames, certificate, igd, mdns, mdnsDirect, mergeMdns, netbios, readPage, upnpDescription } from "./discover";
import { health } from "./health";
import { activeChecks } from "./probes";
import { wifiNow } from "./wifi";

const run = promisify(execFile);

/** Ports worth knowing about on a home network: risky services and ones that say what a device is. */
export const DEFAULT_PORTS = [21, 22, 23, 25, 53, 80, 139, 443, 445, 515, 548, 554, 631, 1400, 1883, 2323, 3306, 3389, 5000, 5001, 5432, 5555, 5900, 6379, 6668, 7000, 8000, 8008, 8009, 8080, 8123, 8443, 8554, 8883, 9100, 27017, 32400, 49152, 62078];
const BANNER_PORTS = new Set([21, 22, 23, 25, 2323]);
const HTTP_PORTS = new Set([80, 1400, 5000, 8000, 8008, 8080, 8123, 49152]);

const ipStr = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

/** Every host address in a CIDR range. Refuses ranges that aren't private or are too big. */
export function hostsIn(cidr: string): string[] {
  const m = cidr.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!m) throw new Error(`"${cidr}" isn't a network like 192.168.1.0/24.`);
  const bits = +m[2];
  if (!isPrivate(m[1])) throw new Error(`${cidr} isn't a home or office network. Lamplight only scans private addresses (10.x, 172.16-31.x, 192.168.x).`);
  if (bits < 22 || bits > 30) throw new Error("Use a network between /22 (1,022 addresses) and /30.");
  const base = (ipNum(m[1]) & (0xffffffff << (32 - bits))) >>> 0;
  const count = 2 ** (32 - bits);
  return Array.from({ length: count - 2 }, (_, i) => ipStr(base + i + 1));
}

/** Virtual adapters from VirtualBox, VMware, Hyper-V, WSL, Docker and VPNs: never the home network. */
const VIRTUAL = /virtualbox|vbox|vmware|vmnet|vethernet|hyper-v|wsl|docker|br-|veth|virbr|tailscale|zerotier|utun|tun\d|tap|wireguard|wg\d|loopback|bluetooth|npcap/i;

export type Iface = { name: string; address: string; cidr: string; virtual: boolean; gateway: boolean };

/** Every network this computer is on, marking virtual ones and the one with the router. */
export function interfaces(gateway?: string): Iface[] {
  const out: Iface[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal || !isPrivate(a.address) || a.address.startsWith("169.254.")) continue;
      const cidr = `${a.address.split(".").slice(0, 3).join(".")}.0/24`;
      // VirtualBox's host-only network is 192.168.56.x even when the adapter has a plain name.
      const virtual = VIRTUAL.test(name) || a.address.startsWith("192.168.56.");
      out.push({ name, address: a.address, cidr, virtual, gateway: !!gateway && gateway.split(".").slice(0, 3).join(".") === a.address.split(".").slice(0, 3).join(".") });
    }
  }
  return out;
}

/** The home network: the one the router is on, else the first real (not virtual) adapter. */
export function pickNetwork(list: Iface[]): Iface | undefined {
  return list.find((i) => i.gateway) ?? list.find((i) => !i.virtual) ?? list[0];
}

/** The network this computer is on, as a /24 around its own address. */
export function localNetwork(): { cidr: string; self: string } | undefined {
  const i = pickNetwork(interfaces());
  return i && { cidr: i.cidr, self: i.address };
}

type Probe = { state: "open" | "refused" | "silent"; banner?: string; ms?: number; web?: { status?: number; title?: string; server?: string; login?: boolean } };

/** Tries a TCP connection. A refusal still proves the host is there. */
export function probe(ip: string, port: number, timeout = 800, read: "banner" | "http" | "none" = HTTP_PORTS.has(port) ? "http" : BANNER_PORTS.has(port) ? "banner" : "none"): Promise<Probe> {
  const isHttp = read === "http";
  const start = performance.now();
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    let data = "";
    let done = false;
    let ms: number | undefined;
    const finish = (p: Probe) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (ms !== undefined) p.ms = ms;
      if (isHttp && p.state === "open" && data) {
        const head = data.split(/\r?\n\r?\n/)[0];
        const status = Number(head.match(/^HTTP\/\d\.\d\s+(\d{3})/)?.[1]) || undefined;
        const headers = Object.fromEntries(head.split(/\r?\n/).slice(1).map((l) => [l.slice(0, l.indexOf(":")).trim().toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]));
        if (status) p.web = readPage(status, headers, data.slice(head.length));
      }
      resolve(p);
    };
    sock.setTimeout(timeout, () => finish({ state: data || sock.readyState === "open" ? "open" : "silent", banner: isHttp ? serverOf(data) : firstLine(data) }));
    sock.on("connect", () => {
      ms = Math.round(performance.now() - start);
      if (isHttp) sock.write(`GET / HTTP/1.0\r\nHost: ${ip}\r\nUser-Agent: lamplight\r\nAccept: text/html\r\nConnection: close\r\n\r\n`);
      else if (read === "none") finish({ state: "open" });
    });
    sock.on("data", (d) => {
      data += d.toString("latin1");
      if (!isHttp && data.includes("\n")) finish({ state: "open", banner: firstLine(data) });
      // Enough of the page to find its title.
      if (data.length > 16384 || (isHttp && /<\/title>/i.test(data))) finish({ state: "open", banner: isHttp ? serverOf(data) : firstLine(data) });
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ECONNREFUSED") ms = Math.round(performance.now() - start);
      finish({ state: e.code === "ECONNREFUSED" || e.code === "ECONNRESET" ? (e.code === "ECONNRESET" ? "open" : "refused") : "silent" });
    });
    sock.on("end", () => finish({ state: "open", banner: isHttp ? serverOf(data) : firstLine(data) }));
  });
}

const serverOf = (s: string) => s.match(/^server:\s*(.+)$/im)?.[1]?.trim();

const firstLine = (s: string) =>
  s
    .split(/\r?\n/)[0]
    // Keep printable ASCII only: drops Telnet negotiation bytes and other control characters.
    .replace(/[^ -~]/g, "")
    .trim()
    .slice(0, 160) || undefined;

/** Runs tasks with a limit on how many are in flight. */
export async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Asks UPnP devices to announce themselves; routers with UPnP on answer as InternetGatewayDevice. */
export function ssdp(wait = 2500, iface?: string): Promise<{ hints: Map<string, string[]>; locations: Map<string, string[]> }> {
  return new Promise((resolve) => {
    const found = new Map<string, string[]>();
    const locations = new Map<string, string[]>();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
    sock.on("message", (m, r) => {
      const t = m.toString("latin1");
      const server = t.match(/^server:\s*(.+)$/im)?.[1]?.trim();
      const st = t.match(/^st:\s*(.+)$/im)?.[1]?.trim();
      const loc = t.match(/^location:\s*(http:\/\/\S+)/im)?.[1];
      if (loc && new URL(loc).hostname === r.address && !locations.get(r.address)?.includes(loc)) locations.set(r.address, [...(locations.get(r.address) ?? []), loc]);
      const list = found.get(r.address) ?? [];
      for (const v of [server && `SSDP server: ${server}`, st && `SSDP: ${st}`]) if (v && !list.includes(v)) list.push(v);
      found.set(r.address, list);
    });
    sock.on("error", () => {
      sock.close();
      resolve({ hints: found, locations });
    });
    sock.bind(0, () => {
      try {
        if (iface) sock.setMulticastInterface(iface);
      } catch {
        /* default interface */
      }
      sock.send(msg, 1900, "239.255.255.250");
      setTimeout(() => sock.send(msg, 1900, "239.255.255.250"), 300);
      setTimeout(() => {
        sock.close();
        resolve({ hints: found, locations });
      }, wait);
    });
  });
}

export async function arpTable(): Promise<Device[]> {
  for (const [cmd, args] of [["ip", ["neigh"]], ["arp", ["-an"]], ["arp", ["-a"]]] as const) {
    try {
      const { stdout } = await run(cmd, [...args], { timeout: 5000 });
      return parseArp(stdout).devices;
    } catch {
      /* try the next command */
    }
  }
  return [];
}

export async function defaultGateway(): Promise<string | undefined> {
  const tries: [string, string[], RegExp][] = [
    ["ip", ["route", "show", "default"], /default via (\d+\.\d+\.\d+\.\d+)/],
    ["route", ["-n", "get", "default"], /gateway:\s*(\d+\.\d+\.\d+\.\d+)/],
    ["netstat", ["-rn"], /^(?:default|0\.0\.0\.0)\s+(\d+\.\d+\.\d+\.\d+)/m],
    ["route", ["print", "0.0.0.0"], /0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/],
  ];
  if (process.platform === "win32") tries.unshift(tries.pop()!);
  for (const [cmd, args, re] of tries) {
    try {
      const { stdout } = await run(cmd, args, { timeout: 5000 });
      const m = stdout.match(re);
      if (m) return m[1];
    } catch {
      /* not this platform */
    }
  }
  return undefined;
}

async function reverse(ip: string): Promise<string | undefined> {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise<string[]>((r) => setTimeout(() => r([]), 1500))]);
    return names[0];
  } catch {
    return undefined;
  }
}

/** How many connections at once. Gentle mode is for small or fussy routers and mesh systems. */
export const PACE = { normal: { knock: 256, depth: 160 }, gentle: { knock: 48, depth: 32 } };

export type ScanOptions = { cidr: string; self?: string; ports?: number[]; timeout?: number; concurrency?: number; gentle?: boolean; onProgress?: (done: number, total: number) => void; onStep?: (text: string) => void };

const TLS_PORTS = new Set([443, 1443, 5001, 8443]);
/** Ports almost every device answers or refuses quickly: enough to tell an address is in use. */
const KNOCK = [80, 443, 22, 53, 445, 139, 62078, 49152, 7000, 8008, 554, 8080];

export async function scanNetwork(o: ScanOptions): Promise<Scan> {
  const hosts = hostsIn(o.cidr);
  const ports = o.ports ?? DEFAULT_PORTS;
  const alive = new Map<string, Port[]>();
  const rtt = new Map<string, number>();
  const web = new Map<string, NonNullable<Details["web"]>>();
  const upnp = ssdp(2500, o.self);
  const bonjour = mdns(o.self);

  // On your own network, first find who's actually there (a quick knock, then the ARP table, which
  // even silent phones answer), and only check those in depth. Empty addresses are most of a /24 and
  // each one costs a full timeout, so this is several times faster. On a network you're not joined
  // to, ARP can't see across the router, so every address gets the full check as before.
  let targets = hosts;
  if (o.self && hosts.includes(o.self)) {
    o.onStep?.("Finding who's home…");
    const here = new Set<string>();
    await pool(
      hosts.flatMap((ip) => KNOCK.map((port) => ({ ip, port }))),
      PACE[o.gentle ? "gentle" : "normal"].knock,
      async ({ ip, port }) => {
        if (here.has(ip)) return;
        if ((await probe(ip, port, 500, "none")).state !== "silent") here.add(ip);
      },
    );
    for (const a of await arpTable()) if (hosts.includes(a.ip)) here.add(a.ip);
    if (here.size) targets = hosts.filter((ip) => here.has(ip));
    o.onStep?.(`Checking ${targets.length} devices in depth…`);
  }
  const jobs = targets.flatMap((ip) => ports.map((port) => ({ ip, port })));
  let done = 0;
  await pool(jobs, o.concurrency ?? PACE[o.gentle ? "gentle" : "normal"].depth, async ({ ip, port }) => {
    const r = await probe(ip, port, o.timeout);
    if (r.state !== "silent") {
      const list = alive.get(ip) ?? [];
      if (r.state === "open") list.push({ port, proto: "tcp", banner: r.banner });
      alive.set(ip, list);
      if (r.ms !== undefined) rtt.set(ip, Math.min(rtt.get(ip) ?? Infinity, r.ms));
      if (r.web) web.set(ip, [...(web.get(ip) ?? []), { port, ...r.web }]);
    }
    if (++done % 200 === 0) o.onProgress?.(done, jobs.length);
  });
  const inRange = new Set(hosts);
  o.onStep?.("Asking devices for their names…");
  const [arp, gateway, announced, bonj] = await Promise.all([arpTable(), defaultGateway(), upnp, bonjour]);
  const macs = new Map(arp.filter((a) => inRange.has(a.ip)).map((a) => [a.ip, a]));
  const ips = [...new Set([...alive.keys(), ...macs.keys(), ...[...announced.hints.keys(), ...bonj.keys()].filter((ip) => inRange.has(ip))])];
  const [names, own, direct, descs, certs] = await Promise.all([
    netbios(ips),
    askNames(ips),
    mdnsDirect(ips),
    Promise.all([...announced.locations].filter(([ip]) => inRange.has(ip)).map(async ([ip, urls]) => [ip, await upnpDescription(urls[0])] as const)),
    Promise.all(ips.flatMap((ip) => (alive.get(ip) ?? []).filter((p) => TLS_PORTS.has(p.port)).map(async (p) => [ip, await certificate(ip, p.port)] as const))),
  ]);
  const devices: Device[] = await Promise.all(
    ips.map(async (ip) => {
      const hints = announced.hints.get(ip);
      const ports = (alive.get(ip) ?? []).sort((a, b) => a.port - b.port);
      if (hints?.some((h) => /InternetGatewayDevice|WANIPConnection/i.test(h))) ports.push({ port: 1900, proto: "udp", service: "upnp", banner: "Answers UPnP internet-gateway requests" });
      const b = mergeMdns(bonj.get(ip), direct.get(ip));
      const u = descs.find(([x]) => x === ip)?.[1];
      const details: Details = {
        name: b?.name ?? u?.name ?? names.get(ip)?.name,
        model: b?.model ?? u?.model,
        maker: u?.maker,
        services: b?.services.length ? b.services.filter((s) => s !== "_services._dns-sd._udp") : undefined,
        netbios: names.get(ip),
        web: web.get(ip),
        tls: certs.filter(([x, c]) => x === ip && c).map(([, c]) => c!),
        rtt: rtt.get(ip),
        probes: await activeChecks(ip, ports.filter((p) => p.proto === "tcp").map((p) => p.port)),
      };
      for (const k of Object.keys(details) as (keyof Details)[]) if (details[k] === undefined || (Array.isArray(details[k]) && !(details[k] as unknown[]).length)) delete details[k];
      // Prefer the name the device gives itself, then what the router knows, then what it announced.
      const hostname = macs.get(ip)?.hostname ?? own.get(ip) ?? (await reverse(ip)) ?? (b?.host ? `${b.host}.local` : undefined);
      return { ip, mac: macs.get(ip)?.mac, hostname, ports, hints, ...(Object.keys(details).length ? { details } : {}) };
    }),
  );
  devices.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  o.onStep?.("Checking the router and the internet connection…");
  const [checked, wifi] = await Promise.all([internetCheck(gateway, announced.locations, devices.find((d) => d.ip === gateway)), wifiNow()]);
  const internet = { ...checked, ...(wifi ? { wifi } : {}) };
  return { at: new Date().toISOString(), source: "lamplight", network: o.cidr, gateway, devices, internet };
}

/** Internet health, plus the router's doors to the internet if it speaks UPnP. */
export async function internetCheck(gateway: string | undefined, locations: Map<string, string[]>, router?: Device) {
  const port = router?.ports.find((p) => p.proto === "tcp")?.port ?? 80;
  const [h, gw] = await Promise.all([health(gateway, port), (async () => {
    // The router usually answers UPnP from its own address; try each description it published.
    for (const url of gateway ? (locations.get(gateway) ?? []) : [...locations.values()].flat()) {
      const r = await igd(url);
      if (r) return r;
    }
    return undefined;
  })()]);
  return { ...h, ...(gw?.externalIp ? { externalIp: gw.externalIp } : {}), ...(gw ? { mappings: gw.mappings } : {}) };
}
