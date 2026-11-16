import { useSyncExternalStore } from "react";
import type { LiveEvent, LiveState } from "@lamplight/core";

/*
 * The site's side of live mode. The scanner runs on your computer and serves its findings on
 * 127.0.0.1; this polls it every couple of seconds with the key from the link it printed. The
 * key is kept in this browser so a reload reconnects.
 */

export type Live = {
  status: "off" | "connecting" | "live" | "lost";
  port?: number;
  key?: string;
  error?: string;
  state?: LiveState;
  /** Every event since connecting, oldest first. */
  events: LiveEvent[];
  /** Events not shown as a toast yet. */
  fresh: LiveEvent[];
};

let live: Live = { status: "off", events: [], fresh: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<Live>) => {
  live = { ...live, ...patch };
  listeners.forEach((l) => l());
};
export const useLive = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => live,
  );

const STORE = "lamplight-live-v1";
let timer: ReturnType<typeof setTimeout> | undefined;
let failures = 0;
let lastId = 0;

const base = () => `http://127.0.0.1:${live.port}`;

async function poll() {
  clearTimeout(timer);
  if (live.status === "off") return;
  try {
    const r = await fetch(`${base()}/state?after=${lastId}`, { headers: { authorization: `Bearer ${live.key}` }, cache: "no-store" });
    if (r.status === 401) {
      disconnect("The key didn't match. Copy the link again from the terminal: it changes each time live mode starts.");
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const state = (await r.json()) as LiveState;
    const fresh = state.events.filter((e) => e.id > lastId);
    // The first answer brings the whole history; don't pop a toast for each old event.
    const isFirst = lastId === 0;
    if (fresh.length) lastId = fresh[fresh.length - 1].id;
    failures = 0;
    set({ status: "live", state, error: undefined, events: [...live.events, ...fresh].slice(-500), fresh: isFirst ? [] : [...live.fresh, ...fresh.filter((e) => e.type !== "scan")] });
    for (const e of isFirst ? [] : fresh) notify(e);
  } catch {
    failures++;
    set({ status: live.state ? "lost" : "connecting", error: failures > 2 ? "Can't reach the scanner on this computer. Is lamplight live still running? If your browser asked to allow access to devices on your local network, allow it." : undefined });
  }
  timer = setTimeout(poll, failures ? Math.min(10000, 2000 * failures) : 2500);
}

export function connect(port: number, key: string) {
  lastId = 0;
  failures = 0;
  set({ status: "connecting", port, key, error: undefined, state: undefined, events: [], fresh: [] });
  try {
    localStorage.setItem(STORE, JSON.stringify({ port, key }));
  } catch {
    /* private mode: works until the tab closes */
  }
  void poll();
}

export function disconnect(error?: string) {
  clearTimeout(timer);
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
  set({ status: "off", error, state: undefined, events: [], fresh: [] });
}

export const dismiss = (id: number) => set({ fresh: live.fresh.filter((e) => e.id !== id) });

export async function rescan() {
  if (live.status !== "live") return;
  await fetch(`${base()}/scan`, { method: "POST", headers: { authorization: `Bearer ${live.key}` } }).catch(() => undefined);
  void poll();
}

export type Fetched = { status: number; contentType: string; title?: string; server?: string; bytes: number; text?: string; dataUrl?: string; truncated?: boolean };

/** Ask the scanner to fetch one page or snapshot from a device, since the browser can't reach it. */
export async function peek(ip: string, port: number, scheme: "http" | "https", path: string): Promise<Fetched | { error: string }> {
  if (live.status === "off" || !live.port) return { error: "Live mode isn't connected." };
  try {
    const u = new URL(`${base()}/fetch`);
    u.searchParams.set("ip", ip);
    u.searchParams.set("port", String(port));
    u.searchParams.set("scheme", scheme);
    u.searchParams.set("path", path);
    const r = await fetch(u, { headers: { authorization: `Bearer ${live.key}` }, cache: "no-store" });
    const body = await r.json();
    return r.ok ? (body as Fetched) : { error: body.error ?? `The device answered ${r.status}.` };
  } catch {
    return { error: "Couldn't reach the scanner on this computer." };
  }
}

/** Reads a link like ...?live=47114&key=abc, from the address bar or pasted text. */
export function parseLiveLink(text: string): { port: number; key: string } | null {
  try {
    const u = new URL(text.trim(), location.origin);
    const port = Number(u.searchParams.get("live"));
    const key = u.searchParams.get("key");
    return port > 0 && port < 65536 && key && /^[a-f0-9]{16,64}$/i.test(key) ? { port, key } : null;
  } catch {
    return null;
  }
}

/** On load: connect from the link in the address bar (then hide the key), or from last time. */
export function resume() {
  const fromUrl = parseLiveLink(location.href);
  if (fromUrl) {
    const u = new URL(location.href);
    u.searchParams.delete("live");
    u.searchParams.delete("key");
    history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    connect(fromUrl.port, fromUrl.key);
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (saved?.port && saved?.key) connect(saved.port, saved.key);
  } catch {
    /* nothing saved */
  }
}

/* ───────────── Desktop notifications, if you turn them on */

export const notifySupported = () => typeof Notification !== "undefined";
let notifyOn = (() => {
  try {
    return localStorage.getItem("lamplight-notify") === "1";
  } catch {
    return false;
  }
})();
export const notifyEnabled = () => notifyOn && notifySupported() && Notification.permission === "granted";
export async function setNotify(on: boolean) {
  if (on && notifySupported() && Notification.permission !== "granted") on = (await Notification.requestPermission()) === "granted";
  notifyOn = on;
  try {
    localStorage.setItem("lamplight-notify", on ? "1" : "0");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
function notify(e: LiveEvent) {
  if (!notifyEnabled() || (e.type !== "joined" && e.type !== "opened")) return;
  try {
    new Notification(e.type === "joined" ? "New device on your Wi-Fi" : "A device opened a service", { body: `${e.name ?? "Unknown device"} (${e.ip})${e.detail ? `: ${e.detail}` : ""}`, tag: `lamplight-${e.id}` });
  } catch {
    /* some browsers only allow notifications from a service worker */
  }
}

export const EVENT_TEXT: Record<LiveEvent["type"], string> = { joined: "Joined the network", left: "Left", back: "Came back", away: "Went away", opened: "Started answering on", closed: "Stopped answering on", moved: "Got a new address", scan: "Full scan finished", lag: "Internet slowed" };
