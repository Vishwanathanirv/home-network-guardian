import { randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { gunzipSync, gzipSync } from "node:zlib";
import https from "node:https";
import { compare, ipNum, isPrivate, type Device, type LiveEvent, type LiveState } from "@lamplight/core";
import { connectTime } from "./health";
import { arpTable, hostsIn, PACE, pool, probe, scanNetwork } from "./net";
import { localHost, serveSite, type SiteFiles } from "./ui";

export type Fetched = { status: number; contentType: string; title?: string; server?: string; bytes: number; text?: string; dataUrl?: string; truncated?: boolean };

/** GETs one resource from a device: an image comes back as a data URL, text (HTML, JSON) as itself. */
export function fetchResource(target: string, timeout = 4000, limit = 3_000_000): Promise<Fetched | undefined> {
  return new Promise((resolve) => {
    let u: URL;
    try {
      u = new URL(target);
    } catch {
      return resolve(undefined);
    }
    const lib = u.protocol === "https:" ? https : http;
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    const req = lib.request(u, { method: "GET", timeout, rejectUnauthorized: false, headers: { "user-agent": "lamplight", accept: "image/*,text/html,*/*" }, agent: false }, (res) => {
      const type = String(res.headers["content-type"] ?? "application/octet-stream").split(";")[0].trim().toLowerCase();
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          truncated = true;
          req.destroy();
        } else chunks.push(c);
      });
      const done = () => {
        const buf = Buffer.concat(chunks);
        const out: Fetched = { status: res.statusCode ?? 0, contentType: type, bytes: size, server: typeof res.headers.server === "string" ? res.headers.server.slice(0, 120) : undefined, truncated: truncated || undefined };
        if (type.startsWith("image/")) out.dataUrl = `data:${type};base64,${buf.toString("base64")}`;
        else if (/^(text\/|application\/(json|xml|javascript))/.test(type) || !type) {
          const text = buf.toString("utf8");
          out.text = text.slice(0, 20000);
          out.title = text
            .match(/<title[^>]*>([^<]{1,140})<\/title>/i)?.[1]
            ?.replace(/\s+/g, " ")
            .trim();
        }
        resolve(out);
      };
      res.on("end", done);
      res.on("close", done);
    });
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(size ? undefined : undefined));
    req.end();
  });
}

/*
 * Live mode: the scanner keeps watching. A quick sweep every few seconds notices devices joining,
 * leaving and coming back; a full scan every few minutes refreshes what each one is and what it
 * answers on. The Lamplight site reads it all from a small server on this computer, which only
 * listens on 127.0.0.1 and only answers requests that carry the key printed at start-up.
 */

/** Ports that almost every device answers or refuses quickly: enough to see who's there. */
const QUICK = [80, 443, 22, 53, 445, 62078, 7000, 8008, 554, 8080];

const keyOf = (d: { mac?: string; ip: string }) => d.mac?.toUpperCase() || d.ip;
// The name a device gives itself, never a chip maker.
const nameOf = (d?: Device) => d?.details?.name ?? d?.hostname?.replace(/\.(home|lan|local)$/i, "").replace(/[-_]+/g, " ");

/**
 * Is this internet reading a real slowdown? It has to be well above the usual (the middle of the
 * last 20 readings), at least 3 times it and 80 ms more, so ordinary wobble isn't reported.
 */
export function lagSpike(history: { internetMs?: number }[], ms?: number): { ms: number; usual: number } | undefined {
  if (ms === undefined) return undefined;
  const past = history.slice(-21, -1).map((h) => h.internetMs).filter((x): x is number => x !== undefined).sort((a, b) => a - b);
  if (past.length < 6) return undefined;
  const usual = past[Math.floor(past.length / 2)];
  return ms > usual * 3 && ms > usual + 80 ? { ms: Math.round(ms), usual: Math.round(usual) } : undefined;
}

/**
 * Pages that may call the scanner's data endpoints from another address: the hosted app, its own
 * preview builds (which always end in the project owner's team suffix, so another Vercel project
 * named "home-network-guardian-something" doesn't match), and local development.
 */
export const ALLOWED_ORIGIN = /^(https:\/\/home-network-guardian(-[a-z0-9-]+)?-vishwanathanirv-2900\.vercel\.app|https:\/\/home-network-guardian\.vercel\.app|http:\/\/(localhost|127\.0\.0\.1):\d+)$/;

/** The data endpoints. Only these ever get CORS headers: the site's own files (whose page holds the key) never do. */
const API = new Set(["/state", "/scan", "/fetch"]);

/** Compares the key in constant time, so its characters can't be guessed one by one from response timing. */
export function keyMatches(given: string | null | undefined, key: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A copy of the built-in site whose page carries this session's key. */
function withKey(files: SiteFiles, port: number, key: string): SiteFiles {
  const page = files.get("index.html");
  if (!page) return files;
  const html = gunzipSync(page.body).toString("utf8").replace("<head>", `<head><meta name="lamplight-live" content="${port}:${key}">`);
  return new Map([...files, ["index.html", { type: page.type, body: gzipSync(html) }]]);
}

export type LiveOptions = { cidr: string; self?: string; port: number; every: number; sweepSeconds?: number; log?: (s: string) => void; site?: SiteFiles; gentle?: boolean };

export function startLive(o: LiveOptions) {
  const key = randomBytes(12).toString("hex");
  const log = o.log ?? (() => {});
  const now = () => new Date().toISOString();
  const state: LiveState = { version: 1, started: now(), network: o.cidr, scanning: null, scan: null, presence: {}, events: [], health: [] };
  let nextId = 1;
  const emit = (e: Omit<LiveEvent, "id" | "at">) => {
    const ev = { id: nextId++, at: now(), ...e };
    state.events.push(ev);
    if (state.events.length > 500) state.events.shift();
    // Phones dozing and waking just open and close their sync ports; that's noise in the window.
    if ((e.type === "opened" || e.type === "closed") && /^(49152|62078)(, (49152|62078))?$/.test(e.detail ?? "")) return;
    log(`${new Date().toLocaleTimeString()}  ${e.type.padEnd(7)} ${e.ip.padEnd(16)}${e.name ? ` ${e.name}` : ""}${e.detail ? `  ${e.detail}` : ""}`);
  };

  const seen = (ip: string, mac?: string) => {
    const k = mac?.toUpperCase() || ip;
    const p = state.presence[k];
    const t = now();
    if (!p) {
      state.presence[k] = { ip, mac, online: true, firstSeen: t, lastSeen: t, since: t, misses: 0 };
      return "new" as const;
    }
    const wasOff = !p.online;
    Object.assign(p, { ip, mac: mac ?? p.mac, lastSeen: t, misses: 0, online: true, ...(wasOff ? { since: t } : {}) });
    return wasOff ? ("back" as const) : ("same" as const);
  };

  // Devices that joined before we knew their name; the next full scan names them in the window.
  const unnamed = new Set<string>();
  let lastLag = 0;
  let full: Promise<void> | null = null;
  let pending: NodeJS.Timeout | null = null;
  async function fullScan(reason: string) {
    if (full) return full;
    full = (async () => {
      state.scanning = { step: reason, pct: 0 };
      try {
        const first = !state.scan;
        const say = (s: string) => first && log(`${new Date().toLocaleTimeString()}  ${s}`);
        say("Scanning your network for the first time…");
        let lastPct = -1;
        const scan = await scanNetwork({
          cidr: o.cidr,
          self: o.self,
          gentle: o.gentle,
          onProgress: (d, t) => {
            const pct = Math.round((d / t) * 100);
            state.scanning = { step: "Checking each device", pct };
            if (first && pct >= lastPct + 25) say(`  ${(lastPct = pct - (pct % 25))}% checked`);
          },
          onStep: (s) => {
            state.scanning = { step: s, pct: 100 };
            say(`  ${s}`);
          },
        });
        const before = state.scan;
        if (before)
          for (const c of compare(before, scan)) {
            if (c.type === "joined" || c.type === "left") continue; // the sweep reports these as they happen
            const d = scan.devices.find((x) => keyOf(x) === keyOf(c.device));
            emit({ type: c.type, ip: c.device.ip, mac: c.device.mac, name: nameOf(d ?? c.device), detail: c.type === "moved" ? `was ${c.from}` : c.ports.join(", ") });
          }
        for (const d of scan.devices) if (seen(d.ip, d.mac) === "new" && before) emit({ type: "joined", ip: d.ip, mac: d.mac, name: nameOf(d) });
        // Keep devices that are away in the list, so the plan doesn't forget them.
        const away = (before?.devices ?? []).filter((d) => !scan.devices.some((x) => keyOf(x) === keyOf(d)));
        state.scan = { ...scan, devices: [...scan.devices, ...away].sort((a, b) => ipNum(a.ip) - ipNum(b.ip)) };
        for (const ip of [...unnamed]) {
          const d = scan.devices.find((x) => x.ip === ip);
          if (!d) continue;
          unnamed.delete(ip);
          const n = nameOf(d);
          if (n) log(`${new Date().toLocaleTimeString()}  named   ${ip.padEnd(16)} ${n}`);
        }
        // A quiet stretch is fine; this line shows it's still watching.
        emit({ type: "scan", ip: o.cidr, detail: `${scan.devices.length} devices, ${scan.devices.filter((d) => nameOf(d)).length} with names` });
      } catch (e) {
        log(`Scan failed: ${(e as Error).message}`);
      } finally {
        state.scanning = null;
        full = null;
      }
    })();
    return full;
  }

  async function sweep() {
    if (!state.scan) return;
    const answered = new Set<string>();
    const hosts = hostsIn(o.cidr);
    await pool(
      hosts.flatMap((ip) => QUICK.map((port) => ({ ip, port }))),
      PACE[o.gentle ? "gentle" : "normal"].knock,
      async ({ ip, port }) => {
        if (answered.has(ip)) return;
        const r = await probe(ip, port, 400, "none");
        if (r.state !== "silent") answered.add(ip);
      },
    );
    // Phones ignore connections, but they still answer the ARP question our knock caused.
    const arp = new Map((await arpTable()).filter((a) => hosts.includes(a.ip)).map((a) => [a.ip, a.mac]));
    for (const ip of arp.keys()) answered.add(ip);
    let unknown = false;
    for (const ip of answered) {
      const known = state.scan.devices.find((d) => d.ip === ip || (arp.get(ip) && d.mac?.toUpperCase() === arp.get(ip)?.toUpperCase()));
      const r = seen(ip, arp.get(ip) ?? known?.mac);
      if (r === "new") {
        unknown = true;
        if (!nameOf(known)) unnamed.add(ip);
        emit({ type: "joined", ip, mac: arp.get(ip), name: nameOf(known) });
      } else if (r === "back") emit({ type: "back", ip, mac: arp.get(ip) ?? known?.mac, name: nameOf(known) });
    }
    for (const p of Object.values(state.presence)) {
      if (!p.online || answered.has(p.ip)) continue;
      // Three missed sweeps in a row before calling it gone: Wi-Fi devices doze.
      if (++p.misses >= 3) {
        p.online = false;
        p.since = now();
        const d = state.scan.devices.find((x) => keyOf(x) === (p.mac?.toUpperCase() || p.ip));
        emit({ type: "away", ip: p.ip, mac: p.mac, name: nameOf(d) });
      }
    }
    // Find out what a newcomer is with a full scan shortly after it arrives.
    if (unknown && !pending) pending = setTimeout(() => {
        pending = null;
        void fullScan("A new device joined");
      }, 15000);
  }

  async function pulse() {
    const gw = state.scan?.gateway;
    const port = state.scan?.devices.find((d) => d.ip === gw)?.ports.find((p) => p.proto === "tcp")?.port ?? 80;
    const [routerMs, internetMs] = await Promise.all([gw ? connectTime(gw, port, 1500) : undefined, connectTime("1.1.1.1", 443, 2000)]);
    state.health.push({ at: now(), routerMs, internetMs });
    if (state.health.length > 240) state.health.shift();
    const lag = lagSpike(state.health, internetMs);
    if (lag && Date.now() - lastLag > 120_000) {
      lastLag = Date.now();
      // Who arrived in the last two minutes? The newest one is the likeliest reason.
      const since = Date.now() - 120_000;
      const s = [...state.events].reverse().find((e) => (e.type === "joined" || e.type === "back") && Date.parse(e.at) >= since);
      emit({ type: "lag", ip: s?.ip ?? gw ?? "internet", mac: s?.mac, name: s?.name, detail: `to ${lag.ms} ms (usually ${lag.usual} ms)${s ? `, right after this ${s.type === "joined" ? "joined" : "came back"}` : ""}` });
    }
  }

  // The page this scanner serves carries this session's key, so opening http://127.0.0.1:<port>
  // connects by itself, even after a refresh or in another browser. Other websites can't read it:
  // they aren't on the allow-list below, and a rebound address fails the host check.
  const site = o.site && withKey(o.site, o.port, key);
  const server = http.createServer((req, res) => {
    if (!localHost(req, o.port)) return res.writeHead(421, { "content-type": "text/plain" }).end("Open Lamplight at http://127.0.0.1 on this computer.");
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    // Another website must never read the page this serves: it carries the key. So the
    // cross-origin grant is given for the data endpoints only, and only to the allow-list.
    if (API.has(url.pathname) && origin && ALLOWED_ORIGIN.test(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    // The whole website, served from this computer. It holds nothing private; the data below needs the key.
    if (site?.size && !API.has(url.pathname) && serveSite(site, req, res, url.pathname)) return;
    if (site?.size && /\.[a-z0-9]+$/i.test(url.pathname)) return res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Lamplight live</title><body style="font:16px system-ui;background:#0b1116;color:#e5ebef;padding:2rem">Lamplight live is running and watching ${o.cidr}. Open the link printed in your terminal.`);
    }
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
    if (!keyMatches(auth, key)) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Wrong or missing key. Use the link printed in the terminal." }));
    }
    if (url.pathname === "/state" && req.method === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return res.end(JSON.stringify({ ...state, events: state.events.filter((e) => e.id > after) }));
    }
    if (url.pathname === "/scan" && req.method === "POST") {
      void fullScan("Scanning again, as asked");
      res.writeHead(202, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true }));
    }
    // Fetch one page or snapshot from a device on this network, so the site can show it.
    // Only private addresses, only GET, size-capped. The browser can't reach the device; this can.
    if (url.pathname === "/fetch" && req.method === "GET") {
      const ip = url.searchParams.get("ip") ?? "";
      const port = Number(url.searchParams.get("port") ?? 80);
      const scheme = url.searchParams.get("scheme") === "https" ? "https" : "http";
      const path = url.searchParams.get("path") || "/";
      if (!isPrivate(ip) || !Number.isInteger(port) || port < 1 || port > 65535 || !hostsIn(o.cidr).includes(ip)) {
        res.writeHead(400, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "Only devices on the network you're watching." }));
      }
      void fetchResource(`${scheme}://${ip}:${port}${path.startsWith("/") ? path : `/${path}`}`).then((r) => {
        if (!r) {
          res.writeHead(502, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "The device didn't answer." }));
        }
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify(r));
      });
      return;
    }
    res.writeHead(404).end();
  });

  const timers: NodeJS.Timeout[] = [];
  const ready = new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(o.port, "127.0.0.1", () => resolve());
  });
  void (async () => {
    await ready;
    await fullScan("First scan");
    timers.push(setInterval(() => void sweep(), (o.sweepSeconds ?? 15) * 1000));
    timers.push(setInterval(() => void fullScan("Regular scan"), o.every * 60_000));
    timers.push(setInterval(() => void pulse(), 10_000));
    void pulse();
  })();

  return {
    key,
    state,
    ready,
    stop() {
      timers.forEach(clearInterval);
      if (pending) clearTimeout(pending);
      server.close();
    },
  };
}
