import { useMemo, useSyncExternalStore } from "react";
import { analyse, compare, DEMO_DETAILS, DEMO_XML_LAST_WEEK, DEMO_XML_TONIGHT, parseNmap, setOui, withDetails, type Change, type DeviceReport, type Kind, type OuiTable, type Report, type Scan } from "@lamplight/core";

/* ───────────── A tiny store backed by localStorage */

function store<T>(key: string, fallback: T) {
  let value: T = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw) value = JSON.parse(raw) as T;
  } catch {
    /* private mode or bad data: start fresh */
  }
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(v: T) {
      value = v;
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* storage full: keep it for this visit */
      }
      listeners.forEach((l) => l());
    },
    use(): T {
      return useSyncExternalStore(
        (l) => (listeners.add(l), () => listeners.delete(l)),
        () => value,
      );
    },
  };
}

export type SavedScan = { id: string; name: string; scan: Scan; demo?: boolean };

const DEMO: SavedScan[] = [
  { id: "demo-tonight", name: "Example home, tonight", scan: { ...withDetails(parseNmap(DEMO_XML_TONIGHT), DEMO_DETAILS), source: "lamplight", network: "192.168.1.0/24", gateway: "192.168.1.1" }, demo: true },
  { id: "demo-last-week", name: "Example home, last week", scan: { ...withDetails(parseNmap(DEMO_XML_LAST_WEEK), DEMO_DETAILS), source: "lamplight", network: "192.168.1.0/24", gateway: "192.168.1.1" }, demo: true },
];

const own = store<SavedScan[]>("lamplight-scans-v1", []);
const active = store<{ now: string; before: string | null }>("lamplight-active-v1", { now: "demo-tonight", before: "demo-last-week" });
/** Where you put each device and what you called it, keyed by MAC address (or IP). */
const places = store<Record<string, { room?: string; name?: string }>>("lamplight-places-v1", {});
/** Problems you've ticked off, keyed by device + problem. */
const done = store<Record<string, number>>("lamplight-done-v1", {});

export const issueKey = (deviceKey: string | undefined, i: { id: string; port?: number }) => `${deviceKey ?? "network"}|${i.id}|${i.port ?? ""}`;
export const useDone = () => done.use();
export function toggleDone(key: string) {
  const cur = { ...done.get() };
  if (cur[key]) delete cur[key];
  else cur[key] = Date.now();
  done.set(cur);
}

export const useScans = () => [...own.use(), ...DEMO];
export const useActive = () => active.use();
export const setActive = (v: { now: string; before: string | null }) => active.set(v);
export function addScan(name: string, scan: Scan): SavedScan {
  const s = { id: `own-${Date.now().toString(36)}`, name, scan };
  own.set([s, ...own.get()]);
  // The newest scan becomes "now"; the one it replaced becomes "before", unless that was the
  // example home, which has nothing to do with yours.
  const prev = active.get().now;
  active.set({ now: s.id, before: prev.startsWith("demo-") ? null : prev });
  return s;
}
export function removeScan(id: string) {
  own.set(own.get().filter((s) => s.id !== id));
  const a = active.get();
  if (a.now === id || a.before === id) active.set({ now: "demo-tonight", before: "demo-last-week" });
}

export const keyOf = (d: { mac?: string; ip: string }) => d.mac?.toUpperCase() || d.ip;
export const usePlaces = () => places.use();
export function place(key: string, patch: { room?: string; name?: string }) {
  const cur = places.get();
  places.set({ ...cur, [key]: { ...cur[key], ...patch } });
}

/* ───────────── Vendor table, loaded once in the background */

let ouiReady = false;
const ouiListeners = new Set<() => void>();
fetch("/oui.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((t: OuiTable | null) => {
    if (!t) return;
    setOui(t);
    ouiReady = true;
    ouiListeners.forEach((l) => l());
  })
  .catch(() => {
    /* vendor names are a nicety; everything works without them */
  });
const useOui = () =>
  useSyncExternalStore(
    (l) => (ouiListeners.add(l), () => ouiListeners.delete(l)),
    () => ouiReady,
  );

/** The current report, the previous scan's changes, and who's new. */
export function useHome(): { report: Report; changes: Change[]; isNew: (d: DeviceReport) => boolean; now: SavedScan; before?: SavedScan } {
  const scans = useScans();
  const a = useActive();
  const oui = useOui();
  const now = scans.find((s) => s.id === a.now) ?? DEMO[0];
  const before = a.before ? scans.find((s) => s.id === a.before && s.id !== now.id) : undefined;
  return useMemo(() => {
    const report = analyse(now.scan);
    const changes = before ? compare(before.scan, now.scan) : [];
    const joined = new Set(changes.filter((c) => c.type === "joined").map((c) => keyOf(c.device)));
    return { report, changes, isNew: (d: DeviceReport) => joined.has(keyOf(d)), now, before };
    // `oui` is listed because loading the vendor table changes what analyse() finds.
  }, [now, before, oui]);
}

/* ───────────── Rooms */

export type Room = { id: string; name: string; x: number; y: number; w: number; h: number; outside?: boolean };

export const ROOMS: Room[] = [
  { id: "living", name: "Living room", x: 0, y: 0, w: 420, h: 330 },
  { id: "kitchen", name: "Kitchen", x: 420, y: 0, w: 260, h: 230 },
  { id: "study", name: "Study", x: 680, y: 0, w: 320, h: 260 },
  { id: "hall", name: "Hall", x: 420, y: 230, w: 260, h: 220 },
  { id: "bedroom", name: "Bedroom", x: 680, y: 260, w: 320, h: 250 },
  { id: "kids", name: "Kids' room", x: 0, y: 330, w: 300, h: 180 },
  { id: "bath", name: "Bath", x: 300, y: 330, w: 120, h: 120 },
  { id: "garden", name: "Garden and driveway", x: 0, y: 510, w: 1000, h: 130, outside: true },
];

const BY_NAME: [RegExp, string][] = [
  [/living|lounge|family|sitting/i, "living"],
  [/kitchen/i, "kitchen"],
  [/study|office|desk/i, "study"],
  [/hall|entry|porch/i, "hall"],
  [/kid|child|nursery/i, "kids"],
  [/bed|master/i, "bedroom"],
  [/garden|drive|yard|outdoor|patio|garage|door|gate/i, "garden"],
];
const BY_KIND: Record<Kind, string | null> = { router: "hall", nas: "study", computer: "study", printer: "study", phone: "living", tv: "living", console: "living", speaker: "living", camera: "garden", smart: "kitchen", unknown: null };

/** Where a device goes: where you put it, else a room its name mentions, else by type. Unknown devices wait on the doorstep. */
export function roomFor(d: DeviceReport, saved?: { room?: string }): string | null {
  if (saved?.room) return saved.room === "doorstep" ? null : saved.room;
  const named = d.hostname && BY_NAME.find(([re]) => re.test(d.hostname!));
  if (named) return named[1];
  if (d.kind === "phone" && d.confidence === "guess" && !d.hostname) return null;
  return BY_KIND[d.kind];
}

export function displayName(d: DeviceReport, saved?: { name?: string }) {
  return saved?.name || d.hostname?.replace(/\.(home|lan|local|localdomain)$/i, "") || d.vendor || d.ip;
}

/** The same device in every scan of the same home, oldest first. */
export function useHistory(d: { mac?: string; ip: string }) {
  const scans = useScans();
  const { now } = useHome();
  return scans
    .filter((s) => !!s.demo === !!now.demo)
    .sort((a, b) => a.scan.at.localeCompare(b.scan.at))
    .map((s) => ({ scan: s, device: s.scan.devices.find((x) => keyOf(x) === keyOf(d)) }));
}

/** 100 is nothing to fix; each open problem takes points off by how serious it is. */
export const SCORE_COST = { critical: 40, high: 25, medium: 12, low: 4, info: 0 } as const;
export const scoreOf = (issues: { severity: keyof typeof SCORE_COST }[]) => Math.max(0, 100 - issues.reduce((n, i) => n + SCORE_COST[i.severity], 0));
export const gradeOf = (score: number) => (score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F");
