import { useEffect, useMemo, useRef, useState } from "react";
import { KIND_NAME, type DeviceReport } from "@lamplight/core";
import { displayName, gradeOf, keyOf, roomFor, ROOMS, scoreOf, usePlaces, usePresence } from "./lib";
import { toneOf } from "./plan";

type Col = { id: string; t: string; get: (d: DeviceReport) => string | number; num?: boolean; mono?: boolean };

/** Every device as a sortable table, for when you want the facts side by side. */
export function DeviceTable({ devices, left, onPick, selected }: { devices: DeviceReport[]; left: (d: DeviceReport) => DeviceReport["issues"]; onPick: (ip: string) => void; selected?: string }) {
  const places = usePlaces();
  const presence = usePresence();
  const [sort, setSort] = useState<{ id: string; dir: 1 | -1 }>({ id: "score", dir: 1 });
  const cols: Col[] = useMemo(
    () => [
      { id: "name", t: "Device", get: (d) => displayName(d, places[keyOf(d)]) },
      { id: "kind", t: "Type", get: (d) => KIND_NAME[d.kind] },
      { id: "room", t: "Room", get: (d) => ROOMS.find((r) => r.id === roomFor(d, places[keyOf(d)]))?.name ?? "Doorstep" },
      { id: "ip", t: "Address", get: (d) => d.ip, mono: true },
      { id: "mac", t: "Hardware ID", get: (d) => d.mac ?? "", mono: true },
      { id: "maker", t: "Made by", get: (d) => d.details?.maker ?? d.vendor ?? "" },
      { id: "model", t: "Model", get: (d) => d.details?.model ?? "" },
      { id: "ports", t: "Services", get: (d) => d.ports.length, num: true },
      { id: "rtt", t: "Response", get: (d) => d.details?.rtt ?? Infinity, num: true },
      { id: "fix", t: "To fix", get: (d) => left(d).length, num: true },
      { id: "score", t: "Grade", get: (d) => scoreOf(left(d)), num: true },
    ],
    [places, left],
  );
  const col = cols.find((c) => c.id === sort.id)!;
  // Sort by address numerically, not as text, so .10 comes after .9.
  const val = (d: DeviceReport) => (col.id === "ip" ? d.ip.split(".").reduce((n, o) => n * 256 + +o, 0) : col.get(d));
  const rows = [...devices].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const sel = useRef<HTMLTableRowElement>(null);
  useEffect(() => sel.current?.scrollIntoView({ block: "nearest" }), [selected]);

  const csv = () => {
    const esc = (v: string | number) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const text = [cols.map((c) => c.t).join(","), ...rows.map((d) => cols.map((c) => esc(c.id === "score" ? gradeOf(scoreOf(left(d))) : c.id === "rtt" ? (d.details?.rtt ?? "") : c.get(d))).join(","))].join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "lamplight-devices.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
        <h2 className="text-[1.05rem] font-bold">
          {devices.length} device{devices.length === 1 ? "" : "s"}
        </h2>
        <button className="rounded-full bg-panel-2 px-3 py-1 text-[13px] font-semibold hover:text-accent" onClick={csv}>
          Download as CSV
        </button>
      </div>
      <div className="scroll-y min-h-0 flex-1 overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[13.5px]">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-line text-left">
              <th className="w-8 px-3 py-2" aria-label="Status" />
              {cols.map((c) => (
                <th key={c.id} className={`px-2 py-2 font-semibold text-faint ${c.num ? "text-right" : ""}`} aria-sort={sort.id === c.id ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button className="hover:text-ink" onClick={() => setSort({ id: c.id, dir: sort.id === c.id ? ((-sort.dir) as 1 | -1) : 1 })}>
                    {c.t}
                    {sort.id === c.id ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const p = presence?.[keyOf(d)];
              const l = left(d);
              const score = scoreOf(l);
              return (
                <tr key={d.ip} ref={d.ip === selected ? sel : undefined} onClick={() => onPick(d.ip)} className={`cursor-pointer border-b border-line hover:bg-panel-2 ${d.ip === selected ? "bg-panel-2" : ""} ${p && !p.online ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2">
                    <span className="block h-2.5 w-2.5 rounded-full" style={{ background: toneOf(l[0]?.severity ?? null), boxShadow: p?.online ? `0 0 8px ${toneOf(l[0]?.severity ?? null)}` : undefined }} title={p ? (p.online ? "Online" : "Away") : undefined} />
                  </td>
                  {cols.map((c) => (
                    <td key={c.id} className={`max-w-[14rem] truncate px-2 py-2 ${c.num ? "text-right tabular-nums" : ""} ${c.mono ? "font-mono text-[12.5px]" : ""} ${c.id === "name" ? "font-semibold" : "text-muted"}`}>
                      {c.id === "score" ? <span style={{ color: score >= 90 ? "var(--ok)" : score >= 55 ? "var(--warn)" : "var(--risk)" }}>{gradeOf(score)}</span> : c.id === "rtt" ? (d.details?.rtt !== undefined ? `${d.details.rtt} ms` : "–") : c.get(d) || "–"}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
