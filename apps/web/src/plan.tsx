import { useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { SEVERITY_RANK, type DeviceReport, type Kind, type Severity } from "@lamplight/core";
import { displayName, keyOf, place, roomFor, ROOMS, usePlaces, type Room } from "./lib";

export const W = 1000;
const H = 640;
const DOOR_Y = H + 20;

/** Simple line pictograms, drawn on a 24-unit grid. */
export const ICON: Record<Kind, string> = {
  router: "M4 15h16v5H4zM8 15l-2-6M16 15l2-6M7.5 17.5h.01M11 17.5h5",
  computer: "M4 6h16v10H4zM2 19h20M10 16v3h4v-3",
  phone: "M8 3h8v18H8zM11 18h2",
  tv: "M3 5h18v12H3zM8 21h8M12 17v4",
  speaker: "M7 3h10v18H7zM12 14.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 7h.01",
  camera: "M3 8h12v8H3zM15 11l6-3v8l-6-3M7 12h.01",
  printer: "M6 9V3h12v6M6 17H3v-8h18v8h-3M6 14h12v7H6z",
  nas: "M5 3h14v18H5zM8 7h8M8 11h8M8 15h3M15 17h.01",
  console: "M6 9h12a4 4 0 0 1 0 8l-2-2H8l-2 2a4 4 0 0 1 0-8zM8 11v3M6.5 12.5h3M15.5 12h.01M17 13.5h.01",
  smart: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  unknown: "M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
};

export const toneOf = (s: Severity | null) => (!s || s === "info" ? "var(--ok)" : SEVERITY_RANK[s] >= 3 ? "var(--risk)" : s === "medium" ? "var(--warn)" : "var(--ok)");

type Placed = { d: DeviceReport; x: number; y: number; room: string | null };

/** Lays devices out in rows inside their room, or along the doorstep below the house. */
export function layout(devices: DeviceReport[], places: Record<string, { room?: string }>): Placed[] {
  const groups = new Map<string | null, DeviceReport[]>();
  for (const d of devices) {
    const r = roomFor(d, places[keyOf(d)]);
    const valid = r && ROOMS.some((x) => x.id === r) ? r : null;
    groups.set(valid, [...(groups.get(valid) ?? []), d]);
  }
  const out: Placed[] = [];
  for (const [rid, list] of groups) {
    const room = ROOMS.find((r) => r.id === rid);
    const box = room ? { x: room.x + 18, y: room.y + 48, w: room.w - 36, h: room.h - 58 } : { x: 90, y: DOOR_Y + 28, w: W - 120, h: 80 };
    const cols = Math.max(1, Math.floor(box.w / 92));
    list.forEach((d, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const rowCount = Math.min(cols, list.length - r * cols);
      const span = box.w / cols;
      const x = room ? box.x + (box.w - rowCount * span) / 2 + span * c + span / 2 : box.x + span * c + span / 2;
      out.push({ d, x, y: box.y + 26 + r * 84, room: rid });
    });
  }
  return out;
}

/** The plan's size in its own units, which grows when devices wait on the doorstep. */
export function planHeight(doorstep: number) {
  return DOOR_Y + (doorstep ? 130 + Math.floor((doorstep - 1) / 9) * 84 : 30);
}

export function FloorPlan({
  devices,
  selected,
  onSelect,
  isNew,
  worstOf = (d) => d.worst,
  open = (d) => d.issues.length,
  dim = () => false,
  away = () => false,
}: {
  devices: DeviceReport[];
  selected?: string;
  onSelect: (ip: string) => void;
  isNew: (d: DeviceReport) => boolean;
  /** The worst problem still to do (ticked-off ones don't count). */
  worstOf?: (d: DeviceReport) => Severity | null;
  /** How many problems are still to do. */
  open?: (d: DeviceReport) => number;
  /** Devices hidden by a search or filter are dimmed, not removed, so the house stays recognisable. */
  dim?: (d: DeviceReport) => boolean;
  /** Live mode: devices that aren't on the network right now. */
  away?: (d: DeviceReport) => boolean;
}) {
  const places = usePlaces();
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ ip: string; x: number; y: number; moved: boolean } | null>(null);
  const placed = layout(devices, places);
  const doorstep = placed.filter((p) => !p.room);
  const height = planHeight(doorstep.length);

  const toSvg = (e: RPointerEvent) => {
    const pt = svg.current!.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    return pt.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const roomAt = (x: number, y: number): Room | undefined => ROOMS.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

  return (
    <svg
      ref={svg}
      viewBox={`-12 -12 ${W + 24} ${height + 24}`}
      width={W + 24}
      height={height + 24}
      className="block select-none overflow-visible"
      role="group"
      aria-label={`Floor plan with ${devices.length} devices`}
      onPointerMove={(e) => {
        if (!drag) return;
        const p = toSvg(e);
        setDrag({ ...drag, x: p.x, y: p.y, moved: drag.moved || Math.hypot(p.x - drag.x, p.y - drag.y) > 4 });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        if (drag.moved) {
          const p = toSvg(e);
          const r = roomAt(p.x, p.y);
          const d = devices.find((x) => x.ip === drag.ip)!;
          place(keyOf(d), { room: r?.id ?? "doorstep" });
        } else onSelect(drag.ip);
        setDrag(null);
      }}
      onPointerLeave={() => setDrag(null)}
    >
      {/* Rooms */}
      {ROOMS.map((r) => (
        <g key={r.id}>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.outside ? "var(--room-out)" : "var(--room)"} stroke="var(--wall)" strokeWidth={r.outside ? 1.5 : 6} strokeDasharray={r.outside ? "6 6" : undefined} />
          <text x={r.x + 16} y={r.y + 30} className="maplabel" fontSize={17} fill="var(--label)">
            {r.name}
          </text>
        </g>
      ))}
      {/* Doors: a gap in the wall and the swing of the door. */}
      {[
        { x: 520, y: 450, dir: 1 },
        { x: 420, y: 120, v: true },
        { x: 680, y: 330, v: true },
        { x: 470, y: 230 },
        { x: 120, y: 330 },
      ].map((d, i) =>
        d.v ? (
          <g key={i}>
            <line x1={d.x} y1={d.y} x2={d.x} y2={d.y + 52} stroke="var(--room)" strokeWidth={8} />
            <path d={`M${d.x} ${d.y}l44 0A44 44 0 0 1 ${d.x} ${d.y + 44}`} fill="none" stroke="var(--wall)" strokeWidth={1.2} opacity={0.6} />
          </g>
        ) : (
          <g key={i}>
            <line x1={d.x} y1={d.y} x2={d.x + 52} y2={d.y} stroke="var(--room)" strokeWidth={8} />
            <path d={`M${d.x} ${d.y}l0 -44A44 44 0 0 1 ${d.x + 44} ${d.y}`} fill="none" stroke="var(--wall)" strokeWidth={1.2} opacity={0.6} />
          </g>
        ),
      )}
      <text x={546} y={496} textAnchor="middle" className="maplabel" fontSize={14} fill="var(--label)">
        front door
      </text>

      {/* The doorstep, for devices nobody has recognised yet. */}
      {doorstep.length > 0 && (
        <g>
          <rect x={60} y={DOOR_Y} width={W - 120} height={118 + Math.floor((doorstep.length - 1) / 9) * 84} rx={10} fill="none" stroke="var(--risk)" strokeWidth={1.4} strokeDasharray="3 6" />
          <text x={80} y={DOOR_Y + 26} className="maplabel" fontSize={18} fill="var(--risk)">
            On the doorstep: devices to identify
          </text>
        </g>
      )}

      {placed.map(({ d, x, y }) => {
        const dragging = drag?.ip === d.ip && drag.moved;
        const px = dragging ? drag.x : x;
        const py = dragging ? drag.y : y;
        const worst = worstOf(d);
        const count = open(d);
        const tone = toneOf(worst);
        const sel = selected === d.ip;
        const name = displayName(d, places[keyOf(d)]);
        return (
          <g
            key={d.ip}
            transform={`translate(${px} ${py})`}
            className="cursor-grab transition-opacity"
            opacity={dim(d) ? 0.18 : away(d) ? 0.42 : 1}
            style={{ ["--tone" as string]: tone, touchAction: "none" }}
            tabIndex={0}
            role="button"
            data-device={d.ip}
            aria-label={`${name}, ${count ? `${count} to fix` : "fine"}${isNew(d) ? ", new" : ""}${away(d) ? ", away" : ""}`}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture?.(e.pointerId);
              const p = toSvg(e);
              setDrag({ ip: d.ip, x: p.x, y: p.y, moved: false });
            }}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(d.ip))}
          >
            {isNew(d) && <circle r={22} fill="none" stroke="var(--accent)" strokeWidth={2} className="new-ring" />}
            <circle r={sel ? 27 : 24} fill="var(--panel)" stroke={tone} strokeWidth={sel ? 4 : 2.5} strokeDasharray={away(d) ? "4 4" : undefined} className={away(d) ? undefined : "lamp"} />
            <g transform="translate(-12 -12)">
              <path d={ICON[d.kind]} fill="none" stroke={worst && SEVERITY_RANK[worst] >= 2 ? tone : "var(--ink)"} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
            </g>
            {count > 0 && (
              <g transform="translate(17 -18)">
                <circle r={9} fill={tone} />
                <text textAnchor="middle" y={4} fontSize={11.5} fontWeight={700} fill="var(--panel)">
                  {count}
                </text>
              </g>
            )}
            <text y={42} textAnchor="middle" className="maplabel" fontSize={12.5} fill="var(--ink)">
              {name.length > 12 ? `${name.slice(0, 11)}…` : name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
