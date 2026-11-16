import dgram from "node:dgram";
import http from "node:http";
import tls from "node:tls";
import type { Mapping } from "@lamplight/core";

/*
 * Asking devices about themselves. Every question here is one a device expects to be asked:
 * phones ask "who can I cast to?" over Bonjour all day, Windows asks for NetBIOS names, and
 * routers publish a UPnP description for anyone on the network. Nothing logs in or guesses
 * passwords.
 */

/* ───────────── Bonjour (mDNS) */

/** Services worth asking about: each one says what kind of device answers. */
export const MDNS_SERVICES = [
  "_services._dns-sd._udp",
  "_googlecast._tcp",
  "_androidtvremote2._tcp",
  "_amzn-wplay._tcp",
  "_airplay._tcp",
  "_raop._tcp",
  "_companion-link._tcp",
  "_apple-mobdev2._tcp",
  "_ipp._tcp",
  "_ipps._tcp",
  "_printer._tcp",
  "_pdl-datastream._tcp",
  "_uscan._tcp",
  "_hap._tcp",
  "_matter._tcp",
  "_sonos._tcp",
  "_spotify-connect._tcp",
  "_smb._tcp",
  "_afpovertcp._tcp",
  "_workstation._tcp",
  "_ssh._tcp",
  "_rfb._tcp",
  "_home-assistant._tcp",
  "_http._tcp",
  "_device-info._tcp",
];

/** A DNS question packet asking for PTR records of each service. */
export function mdnsQuery(services = MDNS_SERVICES, id = 0x4c50): Buffer {
  const parts: Buffer[] = [];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(id, 0);
  head.writeUInt16BE(services.length, 4);
  parts.push(head);
  for (const s of services) {
    for (const label of `${s}.local`.split(".")) {
      const b = Buffer.from(label, "utf8");
      parts.push(Buffer.from([b.length]), b);
    }
    parts.push(Buffer.from([0, 0, 12, 0, 1])); // end of name, type PTR, class IN
  }
  return Buffer.concat(parts);
}

export type Rr = { name: string; type: number; data: string | string[] | { port: number; target: string } };

/** Reads a DNS name, following compression pointers. */
function readName(buf: Buffer, at: number): [string, number] {
  const labels: string[] = [];
  let pos = at;
  let end = -1;
  for (let hops = 0; hops < 64; hops++) {
    const len = buf[pos];
    if (len === undefined) throw new Error("short name");
    if (len === 0) {
      pos++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (end < 0) end = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
      continue;
    }
    labels.push(buf.toString("utf8", pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return [labels.join("."), end >= 0 ? end : pos];
}

/** Every record in a DNS answer: PTR, SRV, TXT and A are the ones we use. */
export function parseDns(buf: Buffer): Rr[] {
  const out: Rr[] = [];
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;
  for (let i = 0; i < qd; i++) pos = readName(buf, pos)[1] + 4;
  for (let i = 0; i < total && pos < buf.length; i++) {
    const [name, p] = readName(buf, pos);
    const type = buf.readUInt16BE(p);
    const len = buf.readUInt16BE(p + 8);
    const rd = p + 10;
    if (type === 12) out.push({ name, type, data: readName(buf, rd)[0] });
    else if (type === 33) out.push({ name, type, data: { port: buf.readUInt16BE(rd + 4), target: readName(buf, rd + 6)[0] } });
    else if (type === 16) {
      const strings: string[] = [];
      for (let q = rd; q < rd + len; ) {
        const l = buf[q];
        strings.push(buf.toString("utf8", q + 1, q + 1 + l));
        q += 1 + l;
      }
      out.push({ name, type, data: strings });
    } else if (type === 1 && len === 4) out.push({ name, type, data: [...buf.subarray(rd, rd + 4)].join(".") });
    pos = rd + len;
  }
  return out;
}

export type MdnsInfo = { name?: string; model?: string; host?: string; services: string[] };

/** Turns the records one device sent into a name, a model and the services it offers. */
export function readMdns(records: Rr[]): MdnsInfo {
  const info: MdnsInfo = { services: [] };
  for (const r of records) {
    if (r.type === 12 && typeof r.data === "string") {
      const m = r.data.match(/^(.*?)\.(_[\w-]+\._(?:tcp|udp))\.local$/);
      if (m) {
        if (!info.services.includes(m[2])) info.services.push(m[2]);
        // Instance names are what people called the device; Chromecasts use an ID here instead.
        if (!info.name && !/^[\w-]{20,}$/.test(m[1]) && !/@/.test(m[1])) info.name = m[1];
        if (!info.name && /@(.+)$/.test(m[1])) info.name = m[1].split("@")[1];
      }
    }
    if (r.type === 16 && Array.isArray(r.data)) {
      const kv = Object.fromEntries(r.data.map((s) => [s.split("=")[0].toLowerCase(), s.slice(s.indexOf("=") + 1)]));
      if (kv.fn) info.name = kv.fn;
      info.model ??= kv.md || kv.model || kv.am || kv.ty || kv.rpmd || kv.usb_mdl || undefined;
    }
    if (r.type === 33 && typeof r.data === "object" && !Array.isArray(r.data)) info.host ??= r.data.target.replace(/\.local$/, "");
  }
  return info;
}

/** Asks the network who offers which Bonjour service and groups the answers by sender. */
export function mdns(iface?: string, wait = 3000): Promise<Map<string, MdnsInfo>> {
  return new Promise((resolve) => {
    const records = new Map<string, Rr[]>();
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(new Map([...records].map(([ip, rs]) => [ip, readMdns(rs)])));
    };
    sock.on("message", (m, r) => {
      try {
        records.set(r.address, [...(records.get(r.address) ?? []), ...parseDns(m)]);
      } catch {
        /* a malformed packet: ignore it */
      }
    });
    sock.on("error", finish);
    sock.bind(0, () => {
      try {
        if (iface) sock.setMulticastInterface(iface);
      } catch {
        /* fall back to the default interface */
      }
      // Two packets: answers are capped in size, so ask for the long list in halves.
      const half = Math.ceil(MDNS_SERVICES.length / 2);
      const send = () => {
        sock.send(mdnsQuery(MDNS_SERVICES.slice(0, half)), 5353, "224.0.0.251");
        sock.send(mdnsQuery(MDNS_SERVICES.slice(half)), 5353, "224.0.0.251");
      };
      send();
      setTimeout(send, 700);
      setTimeout(finish, wait);
    });
  });
}

/* ───────────── NetBIOS: Windows computer names */

const NBSTAT = Buffer.from([0x4c, 0x50, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0x20, 0x43, 0x4b, ...Array(30).fill(0x41), 0, 0, 0x21, 0, 1]);

/** Reads a NetBIOS node status answer: the computer's name and its workgroup. */
export function readNbstat(buf: Buffer): { name: string; group?: string } | undefined {
  if (buf.length < 57) return undefined;
  const count = buf[56];
  let name: string | undefined;
  let group: string | undefined;
  for (let i = 0; i < count; i++) {
    const at = 57 + i * 18;
    if (at + 18 > buf.length) break;
    const n = buf.toString("latin1", at, at + 15).trim();
    const suffix = buf[at + 15];
    const isGroup = (buf.readUInt16BE(at + 16) & 0x8000) !== 0;
    if (suffix === 0 && !isGroup) name ??= n;
    if (suffix === 0 && isGroup) group ??= n;
  }
  return name ? { name, group } : undefined;
}

/** Asks each address for its NetBIOS name. Only Windows machines and Samba servers answer. */
export function netbios(ips: string[], wait = 1500): Promise<Map<string, { name: string; group?: string }>> {
  return new Promise((resolve) => {
    const found = new Map<string, { name: string; group?: string }>();
    const sock = dgram.createSocket("udp4");
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(found);
    };
    sock.on("message", (m, r) => {
      const n = readNbstat(m);
      if (n) found.set(r.address, n);
    });
    sock.on("error", finish);
    sock.bind(0, () => {
      for (const ip of ips) sock.send(NBSTAT, 137, ip);
      setTimeout(finish, wait);
    });
  });
}

/* ───────────── HTTP: a small GET with a size limit */

export function get(url: string, timeout = 2500, limit = 65536): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string } | undefined> {
  return new Promise((resolve) => {
    let body = "";
    const req = http.get(url, { timeout, headers: { "user-agent": "lamplight" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        body += c;
        if (body.length > limit) req.destroy();
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on("close", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
  });
}

const tag = (xml: string, name: string) =>
  xml
    .match(new RegExp(`<${name}>([^<]{1,120})</${name}>`, "i"))?.[1]
    ?.replace(/&amp;/g, "&")
    .trim() || undefined;

/** Reads a UPnP device description: the name, maker and model the device gives itself. */
export async function upnpDescription(url: string): Promise<{ name?: string; maker?: string; model?: string } | undefined> {
  const r = await get(url);
  if (!r || r.status !== 200) return undefined;
  const model = [tag(r.body, "modelName"), tag(r.body, "modelNumber")].filter(Boolean);
  // Don't repeat the number if the name already includes it.
  const modelText = model.length === 2 && model[0]!.includes(model[1]!) ? model[0] : model.join(" ") || undefined;
  return { name: tag(r.body, "friendlyName"), maker: tag(r.body, "manufacturer"), model: modelText };
}

/** What a web page says: the title, the server software and whether it asks for a password. */
export function readPage(status: number, headers: Record<string, string | string[] | undefined>, body: string) {
  const title = body
    .match(/<title[^>]*>([^<]{1,140})<\/title>/i)?.[1]
    ?.replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
  const server = typeof headers.server === "string" ? headers.server.slice(0, 120) : undefined;
  const login = status === 401 || /type\s*=\s*["']?password|<form[^>]+(login|signin|auth)|>\s*(log ?in|sign ?in)\s*</i.test(body) || /basic|digest/i.test(String(headers["www-authenticate"] ?? ""));
  return { status, title: title || undefined, server, login: login || undefined };
}

/* ───────────── TLS certificates */

export function certificate(host: string, port: number, timeout = 2500): Promise<{ port: number; subject?: string; issuer?: string; expires?: string; selfSigned?: boolean } | undefined> {
  return new Promise((resolve) => {
    // We only read the certificate to describe it; nothing is sent over this connection.
    const sock = tls.connect({ host, port, rejectUnauthorized: false, timeout }, () => {
      const c = sock.getPeerCertificate();
      sock.destroy();
      if (!c || !c.subject) return resolve(undefined);
      const name = (x: tls.Certificate) => x.CN || x.O || undefined;
      const subject = name(c.subject);
      const issuer = c.issuer ? name(c.issuer) : undefined;
      resolve({ port, subject: subject ? String(subject) : undefined, issuer: issuer ? String(issuer) : undefined, expires: c.valid_to ? new Date(c.valid_to).toISOString() : undefined, selfSigned: JSON.stringify(c.subject) === JSON.stringify(c.issuer) || undefined });
    });
    sock.on("timeout", () => {
      sock.destroy();
      resolve(undefined);
    });
    sock.on("error", () => resolve(undefined));
  });
}

/* ───────────── The router's doors to the internet (UPnP Internet Gateway Device) */

function post(url: string, body: string, headers: Record<string, string>, timeout = 2500): Promise<{ status: number; body: string } | undefined> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: "POST", timeout, headers: { "content-type": 'text/xml; charset="utf-8"', "content-length": Buffer.byteLength(body), ...headers } }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => {
        data += c;
        if (data.length > 65536) req.destroy();
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
    req.end(body);
  });
}

/** Finds the WAN connection service in a UPnP description: where to send questions about the internet side. */
export function wanService(xml: string, base: string): { type: string; control: string } | undefined {
  for (const m of xml.matchAll(/<service>([\s\S]*?)<\/service>/gi)) {
    const type = tag(m[1], "serviceType");
    const ctrl = tag(m[1], "controlURL");
    if (type && ctrl && /WAN(IP|PPP)Connection/i.test(type)) return { type, control: new URL(ctrl, base).toString() };
  }
  return undefined;
}

const soap = (type: string, action: string, args = "") => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${type}">${args}</u:${action}></s:Body></s:Envelope>`;

/**
 * Asks the router, over UPnP, for its internet address and every port it has opened for a device.
 * This is the same list the router's own settings page shows under "UPnP"; we only read it.
 */
export async function igd(location: string): Promise<{ externalIp?: string; mappings: Mapping[] } | undefined> {
  const desc = await get(location);
  if (!desc || desc.status !== 200) return undefined;
  const svc = wanService(desc.body, location);
  if (!svc) return undefined;
  const call = (action: string, args = "") => post(svc.control, soap(svc.type, action, args), { soapaction: `"${svc.type}#${action}"` });
  const ip = await call("GetExternalIPAddress");
  const externalIp = ip?.status === 200 ? tag(ip.body, "NewExternalIPAddress") : undefined;
  const mappings: Mapping[] = [];
  for (let i = 0; i < 128; i++) {
    const r = await call("GetGenericPortMappingEntry", `<NewPortMappingIndex>${i}</NewPortMappingIndex>`);
    if (!r || r.status !== 200) break;
    const ext = Number(tag(r.body, "NewExternalPort"));
    const client = tag(r.body, "NewInternalClient");
    if (!ext || !client) break;
    mappings.push({
      protocol: /udp/i.test(tag(r.body, "NewProtocol") ?? "") ? "UDP" : "TCP",
      externalPort: ext,
      internalPort: Number(tag(r.body, "NewInternalPort")) || ext,
      client,
      description: tag(r.body, "NewPortMappingDescription"),
      enabled: tag(r.body, "NewEnabled") !== "0",
      lease: Number(tag(r.body, "NewLeaseDuration")) || undefined,
    });
  }
  return { externalIp, mappings };
}

/**
 * Asks one device directly for its own name: a reverse lookup sent straight to the device's
 * multicast-DNS port. iPhones, iPads, Macs and many Linux boxes answer this with names like
 * "Ravis-iPhone.local" even when they don't announce any service. Returns undefined if it stays quiet.
 */
export function askName(ip: string, timeout = 1200): Promise<string | undefined> {
  const q = ip.split(".").reverse().join(".") + ".in-addr.arpa";
  const head = Buffer.alloc(12);
  head.writeUInt16BE(Math.floor(Math.random() * 0xffff), 0);
  head.writeUInt16BE(1, 4);
  const parts: Buffer[] = [head];
  for (const label of q.split(".")) {
    const b = Buffer.from(label, "utf8");
    parts.push(Buffer.from([b.length]), b);
  }
  parts.push(Buffer.from([0, 0, 12, 0, 1])); // PTR, IN
  const packet = Buffer.concat(parts);
  return new Promise((done) => {
    const sock = dgram.createSocket("udp4");
    let over = false;
    const finish = (v?: string) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      done(v);
    };
    const timer = setTimeout(() => finish(), timeout);
    sock.on("error", () => finish());
    sock.on("message", (msg) => {
      try {
        const hit = parseDns(msg).find((r) => r.type === 12 && typeof r.data === "string" && r.data.length > 1);
        if (hit) finish((hit.data as string).replace(/\.$/, ""));
      } catch {
        /* not a DNS answer we understand */
      }
    });
    sock.send(packet, 5353, ip, (e) => e && finish());
  });
}

/** Asks many devices for their names, a few dozen at a time. */
export async function askNames(ips: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ips.length; i += 48) {
    const batch = ips.slice(i, i + 48);
    const got = await Promise.all(batch.map((ip) => askName(ip)));
    batch.forEach((ip, k) => got[k] && out.set(ip, got[k]!));
  }
  return out;
}

/**
 * Asks each device directly which Bonjour services it offers, instead of asking the whole network.
 * A firewall (Windows on a "Public" network especially) drops the group answers to a network-wide
 * question, but always lets through a reply from the very device we just asked.
 */
export function mdnsDirect(ips: string[], wait = 2500): Promise<Map<string, MdnsInfo>> {
  return new Promise((resolve) => {
    const records = new Map<string, Rr[]>();
    const sock = dgram.createSocket("udp4");
    const finish = () => {
      try {
        sock.close();
      } catch {
        /* already closed */
      }
      resolve(new Map([...records].map(([ip, rs]) => [ip, readMdns(rs)])));
    };
    sock.on("message", (m, r) => {
      try {
        records.set(r.address, [...(records.get(r.address) ?? []), ...parseDns(m)]);
      } catch {
        /* a malformed packet: ignore it */
      }
    });
    sock.on("error", finish);
    sock.bind(0, () => {
      const half = Math.ceil(MDNS_SERVICES.length / 2);
      const a = mdnsQuery(MDNS_SERVICES.slice(0, half), 0x4c51);
      const b = mdnsQuery(MDNS_SERVICES.slice(half), 0x4c52);
      const send = () => {
        for (const ip of ips) {
          sock.send(a, 5353, ip, () => {});
          sock.send(b, 5353, ip, () => {});
        }
      };
      send();
      setTimeout(send, 800);
      setTimeout(finish, wait);
    });
  });
}

/** Puts together what a device said to the whole network and what it said to us directly. */
export function mergeMdns(x?: MdnsInfo, y?: MdnsInfo): MdnsInfo | undefined {
  if (!x) return y;
  if (!y) return x;
  return { services: [...new Set([...x.services, ...y.services])], name: x.name ?? y.name, model: x.model ?? y.model, host: x.host ?? y.host };
}
