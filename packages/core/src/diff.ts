import type { Device, Scan } from "./types";

export type Change =
  | { type: "joined"; device: Device }
  | { type: "left"; device: Device }
  | { type: "moved"; device: Device; from: string }
  | { type: "opened"; device: Device; ports: number[] }
  | { type: "closed"; device: Device; ports: number[] };

/**
 * What changed between two scans. Devices are matched by MAC address (an IP can change when a
 * device reconnects), falling back to IP when a scan has no MACs.
 */
export function compare(before: Scan, after: Scan): Change[] {
  const key = (d: Device) => d.mac?.toUpperCase() || `ip:${d.ip}`;
  const old = new Map(before.devices.map((d) => [key(d), d]));
  const now = new Map(after.devices.map((d) => [key(d), d]));
  const out: Change[] = [];
  for (const [k, d] of now) {
    const o = old.get(k);
    if (!o) {
      out.push({ type: "joined", device: d });
      continue;
    }
    if (o.ip !== d.ip) out.push({ type: "moved", device: d, from: o.ip });
    // Only compare ports when both scans looked at ports.
    if (before.source !== "arp" && after.source !== "arp") {
      const was = new Set(o.ports.map((p) => p.port));
      const is = new Set(d.ports.map((p) => p.port));
      const opened = [...is].filter((p) => !was.has(p));
      const closed = [...was].filter((p) => !is.has(p));
      if (opened.length) out.push({ type: "opened", device: d, ports: opened });
      if (closed.length) out.push({ type: "closed", device: d, ports: closed });
    }
  }
  for (const [k, d] of old) if (!now.has(k)) out.push({ type: "left", device: d });
  return out;
}
