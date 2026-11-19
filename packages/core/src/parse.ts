import type { Device, Port, Scan } from "./types";

/* ───────────── A tiny XML reader, enough for nmap's output (no DTDs, no namespaces). */

type El = { name: string; attrs: Record<string, string>; children: El[] };

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m)));

export function parseXml(xml: string): El {
  const root: El = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const m of xml.matchAll(re)) {
    if (!m[2]) continue;
    const [, close, name, attrText, selfClose] = m;
    if (close) {
      // Pop to the matching element; tolerate sloppy nesting.
      const i = stack.map((e) => e.name).lastIndexOf(name);
      if (i > 0) stack.length = i;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = unescape(a[2] ?? a[3] ?? "");
    const el: El = { name, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!selfClose) stack.push(el);
  }
  return root;
}

const kids = (e: El | undefined, name: string) => e?.children.filter((c) => c.name === name) ?? [];
const kid = (e: El | undefined, name: string) => e?.children.find((c) => c.name === name);

/** Reads `nmap -oX` output: hosts that are up, their MAC and vendor, open ports and OS guesses. */
export function parseNmap(xml: string): Scan {
  const doc = parseXml(xml);
  const run = kid(doc, "nmaprun");
  if (!run) throw new Error("This isn't nmap XML. Save the scan with -oX scan.xml and try again.");
  const devices: Device[] = [];
  for (const h of kids(run, "host")) {
    if (kid(h, "status")?.attrs.state === "down") continue;
    const addrs = kids(h, "address");
    const ip = addrs.find((a) => a.attrs.addrtype === "ipv4")?.attrs.addr ?? addrs.find((a) => a.attrs.addrtype === "ipv6")?.attrs.addr;
    // A scan file can come from anywhere; an "address" that isn't one never reaches a link.
    if (!ip || !isIp(ip)) continue;
    const macEl = addrs.find((a) => a.attrs.addrtype === "mac");
    const ports: Port[] = [];
    for (const p of kids(kid(h, "ports"), "port")) {
      if (kid(p, "state")?.attrs.state !== "open") continue;
      const svc = kid(p, "service");
      ports.push({
        port: +p.attrs.portid,
        proto: p.attrs.protocol === "udp" ? "udp" : "tcp",
        service: svc?.attrs.name,
        product: svc?.attrs.product,
        version: [svc?.attrs.version, svc?.attrs.extrainfo].filter(Boolean).join(" ") || undefined,
      });
    }
    const os = kids(kid(h, "os"), "osmatch")[0]?.attrs.name;
    const hostname = kids(kid(h, "hostnames"), "hostname")[0]?.attrs.name;
    const devtype = kids(kid(h, "ports"), "port")
      .map((p) => kid(p, "service")?.attrs.devicetype)
      .find(Boolean);
    devices.push({ ip, mac: macEl?.attrs.addr?.toUpperCase(), vendor: macEl?.attrs.vendor, hostname, os, ports, hints: devtype ? [devtype] : undefined });
  }
  const finished = kid(kid(run, "runstats"), "finished")?.attrs.time;
  const args = run.attrs.args ?? "";
  return { at: finished ? new Date(+finished * 1000).toISOString() : new Date().toISOString(), source: "nmap", network: args.match(/\b(\d+\.\d+\.\d+\.\d+\/\d+)\b/)?.[1], devices: devices.sort(byIp) };
}

/**
 * Reads an ARP table: Windows `arp -a`, macOS/Linux `arp -a` / `arp -an`, or Linux `ip neigh`.
 * This lists devices but not their open ports.
 */
export function parseArp(text: string): Scan {
  const seen = new Map<string, Device>();
  for (const line of text.split(/\r?\n/)) {
    const ip = line.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1];
    const mac = line.match(/\b([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\b/i)?.[1];
    if (!ip || !isIpv4(ip) || !mac || /incomplete|FAILED/i.test(line)) continue;
    const norm = mac
      .split(/[:-]/)
      .map((b) => b.padStart(2, "0"))
      .join(":")
      .toUpperCase();
    if (norm === "FF:FF:FF:FF:FF:FF" || /^01:00:5E/.test(norm) || /^(224|239|255)\./.test(ip) || ip.endsWith(".255")) continue;
    const host = line.match(/^\s*([a-z0-9][\w.-]*)\s+\(/i)?.[1];
    seen.set(ip, { ip, mac: norm, hostname: host && host !== "?" ? host : undefined, ports: [] });
  }
  if (!seen.size) throw new Error("No devices found. Paste the output of arp -a (or ip neigh on Linux).");
  return { at: new Date().toISOString(), source: "arp", devices: [...seen.values()].sort(byIp) };
}

/** Reads any supported format: Lamplight scanner JSON, nmap XML or an ARP table. */
export function parseAny(text: string): Scan {
  const t = text.trim();
  if (t.startsWith("{")) {
    let j: Scan;
    try {
      j = JSON.parse(t);
    } catch {
      throw new Error("This looks like JSON but couldn't be read.");
    }
    if (!Array.isArray(j.devices)) throw new Error("This JSON isn't a Lamplight scan (no devices list).");
    return { ...j, devices: j.devices.filter((d) => typeof d.ip === "string" && isIp(d.ip)).map((d) => ({ ...d, ports: Array.isArray(d.ports) ? d.ports : [] })) };
  }
  if (t.startsWith("<")) return parseNmap(t);
  return parseArp(t);
}

export const ipNum = (ip: string) => ip.split(".").reduce((n, o) => n * 256 + +o, 0);
export const byIp = (a: Device, b: Device) => ipNum(a.ip) - ipNum(b.ip);

/** A plain dotted IPv4 address, each part 0-255 (no host names, ports or paths hiding inside). */
export const isIpv4 = (ip: string) => /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(ip);
/** An IP address a scan may contain: IPv4, or IPv6 written with hex digits and colons only. */
export const isIp = (ip: string) => isIpv4(ip) || (/^[0-9a-f:]{2,39}$/i.test(ip) && ip.includes(":"));

/** True for addresses that only exist inside a home or office network. */
export function isPrivate(ip: string) {
  if (!isIpv4(ip)) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}
