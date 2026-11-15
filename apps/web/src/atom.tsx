import { useMemo, useState } from "react";
import { KIND_NAME, type DeviceReport, type Kind, type Severity } from "@lamplight/core";
import { activity, displayName, keyOf, usePlaces, usePresence } from "./lib";
import { ICON, toneOf } from "./plan";
import { MapView, type MapHandle } from "./MapView";
import type { Ref } from "react";

/* The network drawn as an atom: the router is the nucleus, every device orbits it on a shell
 * grouped by what kind of thing it is. Risky devices glow red and pulse. */

const ORDER: Kind[] = ["phone", "computer", "tv", "speaker", "console", "camera", "printer", "nas", "smart", "unknown"];
const NODE = 11; // spacing budget per device around a ring

type Placed = { d: DeviceReport; x: number; y: number; r: number };
type Shell = { kind: Kind; radius: number; nodes: Placed[]; dur: number; dir: 1 | -1 };

export function Atom({
  devices,
  gateway,
  selected,
  onPick,
  worstOf,
  isNew,
  dim = () => false,
  onNucleus,
  mapRef,
  insets = { l: 0, t: 0, r: 0, b: 0 },
}: {
  devices: DeviceReport[];
  gateway?: string;
  selected?: string;
  onPick: (ip: string) => void;
  worstOf: (d: DeviceReport) => Severity | null;
  isNew: (d: DeviceReport) => boolean;
  dim?: (d: DeviceReport) => boolean;
  onNucleus: () => void;
  mapRef?: Ref<MapHandle>;
  insets?: { l: number; t: number; r: number; b: number };
}) {
  const places = usePlaces();
  const presence = usePresence();
  const [hover, setHover] = useState<{ d: DeviceReport; x: number; y: number } | null>(null);
  const [frozen, setFrozen] = useState(false);

  const router = devices.find((d) => d.ip === gateway) ?? devices.find((d) => d.kind === "router");

  const { shells, size } = useMemo(() => {
    const rest = devices.filter((d) => d !== router);
    const byKind = new Map<Kind, DeviceReport[]>();
    for (const d of rest) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
    const kinds = ORDER.filter((k) => byKind.has(k));
    let radius = 130;
    const shells: Shell[] = kinds.map((kind, i) => {
      const list = (byKind.get(kind) ?? []).sort((a, b) => (worstOf(b) ? 1 : 0) - (worstOf(a) ? 1 : 0));
      // Give a crowded shell enough room so its dots don't touch.
      const need = (list.length * NODE) / (2 * Math.PI);
      radius = Math.max(radius + 66, need);
      const phase = i * 0.6;
      const nodes = list.map((d, j) => {
        const a = (j / list.length) * Math.PI * 2 + phase;
        return { d, x: Math.cos(a) * radius, y: Math.sin(a) * radius, r: radius };
      });
      return { kind, radius, nodes, dur: 70 + i * 26, dir: i % 2 ? -1 : (1 as 1 | -1) };
    });
    return { shells, size: (radius + 60) * 2 };
  }, [devices, router, worstOf]);

  const half = size / 2;
  const maxR = shells.length ? shells[shells.length - 1].radius : 130;
  const moving = typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nodeEl = (p: Placed, spin: boolean, i: number) => {
    const d = p.d;
    const worst = worstOf(d);
    const tone = toneOf(worst);
    const off = presence?.[keyOf(d)] && !presence[keyOf(d)].online;
    const sel = d.ip === selected;
    const dur = (p.r / 90 + 1.6).toFixed(2);
    const begin = `${-((i * 1.7) % 3).toFixed(2)}s`;
    return (
      <g key={d.ip} transform={`translate(${half + p.x} ${half + p.y})`} opacity={dim(d) ? 0.12 : off ? 0.4 : 1}>
        <line x1={0} y1={0} x2={-p.x} y2={-p.y} stroke={worst ? tone : "var(--line)"} strokeWidth={worst ? 1.1 : 0.6} opacity={worst ? 0.5 : 0.28} />
        {/* A packet of data travelling along the bond toward the router. */}
        {moving && !off && !dim(d) && (
          <circle r={worst ? 2.1 : 1.6} fill={worst ? tone : "var(--accent)"}>
            <animateMotion path={`M0 0 L${-p.x} ${-p.y}`} dur={`${dur}s`} begin={begin} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;0.9;0" keyTimes="0;0.15;0.7;1" dur={`${dur}s`} begin={begin} repeatCount="indefinite" />
          </circle>
        )}
        <g
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          aria-label={`${displayName(d, places[keyOf(d)])}, ${worst ? "needs attention" : "fine"}${off ? ", away" : ""}`}
          data-device={d.ip}
          onClick={() => onPick(d.ip)}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(d.ip))}
          onPointerEnter={(e) => {
            setFrozen(true);
            const r = (e.currentTarget as SVGGElement).getBoundingClientRect();
            setHover({ d, x: r.left + r.width / 2, y: r.top });
          }}
          onPointerLeave={() => setHover(null)}
        >
          <circle r={sel ? 15 : 13} fill="var(--panel)" stroke={tone} strokeWidth={sel ? 3 : 1.6} style={{ filter: `drop-shadow(0 0 ${worst ? 7 : 3}px ${tone})` }} />
          {!spin && (
            <svg x={-6.5} y={-6.5} width={13} height={13} viewBox="0 0 24 24" className="pointer-events-none">
              <path d={ICON[d.kind]} fill="none" stroke={tone} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {worst && <circle className="risky-node pointer-events-none" r={3} fill={tone} />}
          {isNew(d) && <circle r={sel ? 19 : 17} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="3 3" className="pointer-events-none" />}
        </g>
      </g>
    );
  };

  const atom = (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={`block select-none overflow-visible ${frozen ? "atom-paused" : ""}`}
      onPointerLeave={() => {
        setFrozen(false);
        setHover(null);
      }}
      role="group"
      aria-label="Your network as an atom"
    >
      {/* Faint shell guides and a slim radar sweep behind everything. */}
      <defs>
        <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <g opacity={0.6}>
        {shells.map((s) => (
          <circle key={s.kind} cx={half} cy={half} r={s.radius} fill="none" stroke="var(--line)" strokeWidth={0.7} strokeDasharray="2 7" />
        ))}
      </g>
      <line className="radar" x1={half} y1={half} x2={half + maxR} y2={half} stroke="url(#beam)" strokeWidth={2} />

      {/* Each shell is a rotating group; its label stays still on top. */}
      {shells.map((s) => (
        <g key={s.kind} className="shell" style={{ animationDuration: `${s.dur}s`, animationDirection: s.dir === -1 ? "reverse" : "normal" }}>
          {s.nodes.map((p, i) => nodeEl(p, s.nodes.length > 10, i))}
        </g>
      ))}

      {/* Expanding pulse rings from the core. */}
      {moving && [0, 1, 2].map((n) => (
        <circle key={n} className="nucleus-ring" cx={half} cy={half} r={30} fill="none" stroke="var(--accent)" strokeWidth={1.5} style={{ animationDelay: `${n}s` }} />
      ))}

      {/* The nucleus: the router. */}
      <g transform={`translate(${half} ${half})`} className="cursor-pointer" role="button" tabIndex={0} aria-label="Your router and network" data-device={router?.ip} onClick={onNucleus} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onNucleus())}>
        <circle r={42} fill="var(--accent)" opacity={0.08} />
        <circle r={30} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} style={{ filter: "drop-shadow(0 0 14px var(--accent))" }} />
        <svg x={-15} y={-15} width={30} height={30} viewBox="0 0 24 24" className="pointer-events-none">
          <path d={ICON.router} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <text y={52} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[12px]">
          {devices.length} devices
        </text>
      </g>

      {/* Shell name tags, not rotating. */}
      {shells.map((s) => (
        <text key={s.kind} x={half} y={half - s.radius - 9} textAnchor="middle" className="pointer-events-none fill-[var(--faint)] font-mono text-[11px]">
          {KIND_NAME[s.kind].toLowerCase()} · {s.nodes.length}
        </text>
      ))}
    </svg>
  );

  return (
    <>
      <MapView ref={mapRef} w={size} h={size} insets={insets}>
        {atom}
      </MapView>
      {hover && (
        <div data-ui className="pointer-events-none fixed z-30 w-[15rem] -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-xl border border-line bg-panel p-3 shadow-[var(--shadow)]" style={{ left: hover.x, top: hover.y }}>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: toneOf(worstOf(hover.d)) }} />
            <span className="truncate font-semibold">{displayName(hover.d, places[keyOf(hover.d)])}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {KIND_NAME[hover.d.kind]}
            {hover.d.details?.model ? ` · ${hover.d.details.model}` : hover.d.vendor ? ` · ${hover.d.vendor}` : ""}
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-faint">{hover.d.ip}</div>
          <div className="mt-1.5 text-[12.5px]">
            <span className="text-faint">Doing: </span>
            {activity(hover.d)}
          </div>
          {worstOf(hover.d) && <div className="mt-1 text-[12.5px] font-semibold text-risk">{hover.d.issues.filter((i) => i.severity !== "info").length} to fix — tap to open</div>}
        </div>
      )}
    </>
  );
}
