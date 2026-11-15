import { execFile } from "node:child_process";
import dgram from "node:dgram";
import { promises as dns } from "node:dns";
import net from "node:net";
import os from "node:os";
import { promisify } from "node:util";
import { isPrivate, ipNum, parseArp, type Device, type Port, type Scan } from "@lamplight/core";

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

/** The network this computer is on, as a /24 around its own address. */
export function localNetwork(): { cidr: string; self: string } | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && isPrivate(a.address) && !a.address.startsWith("169.254.")) {
        return { cidr: `${a.address.split(".").slice(0, 3).join(".")}.0/24`, self: a.address };
      }
    }
  }
  return undefined;
}

type Probe = { state: "open" | "refused" | "silent"; banner?: string };

/** Tries a TCP connection. A refusal still proves the host is there. */
export function probe(ip: string, port: number, timeout = 800, read: "banner" | "http" | "none" = HTTP_PORTS.has(port) ? "http" : BANNER_PORTS.has(port) ? "banner" : "none"): Promise<Probe> {
  const isHttp = read === "http";
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port });
    let data = "";
    let done = false;
    const finish = (p: Probe) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(p);
    };
    sock.setTimeout(timeout, () => finish({ state: data || sock.readyState === "open" ? "open" : "silent", banner: firstLine(data) }));
    sock.on("connect", () => {
      if (isHttp) sock.write(`HEAD / HTTP/1.0\r\nHost: ${ip}\r\nUser-Agent: lamplight\r\n\r\n`);
      else if (read === "none") finish({ state: "open" });
    });
    sock.on("data", (d) => {
      data += d.toString("latin1");
      if (isHttp ? /\r?\n\r?\n/.test(data) : data.includes("\n")) finish({ state: "open", banner: isHttp ? data.match(/^server:\s*(.+)$/im)?.[1]?.trim() : firstLine(data) });
      if (data.length > 4096) finish({ state: "open", banner: firstLine(data) });
    });
    sock.on("error", (e: NodeJS.ErrnoException) => finish({ state: e.code === "ECONNREFUSED" || e.code === "ECONNRESET" ? (e.code === "ECONNRESET" ? "open" : "refused") : "silent" }));
    sock.on("end", () => finish({ state: "open", banner: firstLine(data) }));
  });
}

const firstLine = (s: string) =>
  s
    .split(/\r?\n/)[0]
    // Keep printable ASCII only: drops Telnet negotiation bytes and other control characters.
    .replace(/[^ -~]/g, "")
    .trim()
    .slice(0, 160) || undefined;

/** Runs tasks with a limit on how many are in flight. */
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

/** Asks UPnP devices to announce themselves; routers with UPnP on answer as InternetGatewayDevice. */
export function ssdp(wait = 2500): Promise<Map<string, string[]>> {
  return new Promise((resolve) => {
    const found = new Map<string, string[]>();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const msg = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n');
    sock.on("message", (m, r) => {
      const t = m.toString("latin1");
      const server = t.match(/^server:\s*(.+)$/im)?.[1]?.trim();
      const st = t.match(/^st:\s*(.+)$/im)?.[1]?.trim();
      const list = found.get(r.address) ?? [];
      for (const v of [server && `SSDP server: ${server}`, st && `SSDP: ${st}`]) if (v && !list.includes(v)) list.push(v);
      found.set(r.address, list);
    });
    sock.on("error", () => {
      sock.close();
      resolve(found);
    });
    sock.bind(0, () => {
      sock.send(msg, 1900, "239.255.255.250");
      setTimeout(() => sock.send(msg, 1900, "239.255.255.250"), 300);
      setTimeout(() => {
        sock.close();
        resolve(found);
      }, wait);
    });
  });
}

async function arpTable(): Promise<Device[]> {
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

async function defaultGateway(): Promise<string | undefined> {
  const tries: [string, string[], RegExp][] = [
    ["ip", ["route", "show", "default"], /default via (\d+\.\d+\.\d+\.\d+)/],
    ["route", ["-n", "get", "default"], /gateway:\s*(\d+\.\d+\.\d+\.\d+)/],
    ["netstat", ["-rn"], /^(?:default|0\.0\.0\.0)\s+(\d+\.\d+\.\d+\.\d+)/m],
    ["route", ["print", "0.0.0.0"], /0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/],
  ];
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

export type ScanOptions = { cidr: string; ports?: number[]; timeout?: number; concurrency?: number; onProgress?: (done: number, total: number) => void };

export async function scanNetwork(o: ScanOptions): Promise<Scan> {
  const hosts = hostsIn(o.cidr);
  const ports = o.ports ?? DEFAULT_PORTS;
  const alive = new Map<string, Port[]>();
  const jobs = hosts.flatMap((ip) => ports.map((port) => ({ ip, port })));
  let done = 0;
  const upnp = ssdp();
  await pool(jobs, o.concurrency ?? 256, async ({ ip, port }) => {
    const r = await probe(ip, port, o.timeout);
    if (r.state !== "silent") {
      const list = alive.get(ip) ?? [];
      if (r.state === "open") list.push({ port, proto: "tcp", banner: r.banner });
      alive.set(ip, list);
    }
    if (++done % 500 === 0) o.onProgress?.(done, jobs.length);
  });
  const inRange = new Set(hosts);
  const [arp, gateway, announced] = await Promise.all([arpTable(), defaultGateway(), upnp]);
  const macs = new Map(arp.filter((a) => inRange.has(a.ip)).map((a) => [a.ip, a]));
  const ips = [...new Set([...alive.keys(), ...macs.keys(), ...[...announced.keys()].filter((ip) => inRange.has(ip))])];
  const devices: Device[] = await Promise.all(
    ips.map(async (ip) => {
      const hints = announced.get(ip);
      const ports = (alive.get(ip) ?? []).sort((a, b) => a.port - b.port);
      if (hints?.some((h) => /InternetGatewayDevice|WANIPConnection/i.test(h))) ports.push({ port: 1900, proto: "udp", service: "upnp", banner: "Answers UPnP internet-gateway requests" });
      return { ip, mac: macs.get(ip)?.mac, hostname: macs.get(ip)?.hostname ?? (await reverse(ip)), ports, hints };
    }),
  );
  devices.sort((a, b) => ipNum(a.ip) - ipNum(b.ip));
  return { at: new Date().toISOString(), source: "lamplight", network: o.cidr, gateway, devices };
}
