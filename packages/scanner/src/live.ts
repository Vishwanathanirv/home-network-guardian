import { randomBytes } from "node:crypto";
import http from "node:http";
import { compare, ipNum, type Device, type LiveEvent, type LiveState } from "@lamplight/core";
import { connectTime } from "./health";
import { arpTable, hostsIn, pool, probe, scanNetwork } from "./net";

/*
 * Live mode: the scanner keeps watching. A quick sweep every few seconds notices devices joining,
 * leaving and coming back; a full scan every few minutes refreshes what each one is and what it
 * answers on. The Lamplight site reads it all from a small server on this computer, which only
 * listens on 127.0.0.1 and only answers requests that carry the key printed at start-up.
 */

/** Ports that almost every device answers or refuses quickly: enough to see who's there. */
const QUICK = [80, 443, 22, 53, 445, 62078, 7000, 8008, 554, 8080];

const keyOf = (d: { mac?: string; ip: string }) => d.mac?.toUpperCase() || d.ip;
const nameOf = (d?: Device) => d?.details?.name ?? d?.hostname?.replace(/\.(home|lan|local)$/i, "") ?? d?.vendor;

export type LiveOptions = { cidr: string; self?: string; port: number; every: number; sweepSeconds?: number; log?: (s: string) => void };

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
    log(`${new Date().toLocaleTimeString()}  ${e.type.padEnd(7)} ${e.name ?? ""} ${e.ip}${e.detail ? `  ${e.detail}` : ""}`);
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

  let full: Promise<void> | null = null;
  let pending: NodeJS.Timeout | null = null;
  async function fullScan(reason: string) {
    if (full) return full;
    full = (async () => {
      state.scanning = { step: reason, pct: 0 };
      try {
        const scan = await scanNetwork({ cidr: o.cidr, self: o.self, onProgress: (d, t) => (state.scanning = { step: "Checking every address", pct: Math.round((d / t) * 100) }), onStep: (s) => (state.scanning = { step: s, pct: 100 }) });
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
        emit({ type: "scan", ip: o.cidr, detail: `${scan.devices.length} devices` });
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
      512,
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
  }

  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    res.setHeader("Vary", "Origin");
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Lamplight live</title><body style="font:16px system-ui;background:#0b1116;color:#e5ebef;padding:2rem">Lamplight live is running and watching ${o.cidr}. Open the link printed in your terminal.`);
    }
    const auth = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? url.searchParams.get("key");
    if (auth !== key) {
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
