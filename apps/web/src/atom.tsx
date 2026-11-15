import { useMemo, useState } from "react";
import { KIND_NAME, type DeviceReport, type Kind, type Severity } from "@lamplight/core";
import { activity, displayName, keyOf, usePlaces, usePresence } from "./lib";
import { ICON, toneOf } from "./plan";
import { MapView, type MapHandle } from "./MapView";
import type { Ref } from "react";

/* The network drawn as an atom: the router is the nucleus, every device orbits it.
 * Devices are grouped by what kind of thing they are; a kind with many devices spreads
 * across several concentric rings (electron shells) so it never collapses into one solid
 * donut. Each ring turns at its own speed. Risky devices sit on the inner rings, glow red,
 * pulse, and send a packet of data toward the core; calm devices are quiet points of light. */

const ORDER: Kind[] = ["phone", "computer", "tv", "speaker", "console", "camera", "printer", "nas", "smart", "unknown"];

type Placed = { d: DeviceReport; x: number; y: number; r: number };
type Ring = { kind: Kind; radius: number; nodes: Placed[]; dur: number; dir: 1 | -1 };

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

  // Dots shrink as the crowd grows, so a big network reads as fine texture instead of a blob.
  const count = devices.length;
  const base = count > 120 ? 6 : count > 60 ? 7.5 : count > 30 ? 9.5 : 12;
  const showIcons = base >= 9.5;
  const arc = base * 2 + 11; // keep neighbouring dots on a ring from touching

  const { rings, counts, size } = useMemo(() => {
    const rest = devices.filter((d) => d !== router);
    const byKind = new Map<Kind, DeviceReport[]>();
    for (const d of rest) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
    const kinds = ORDER.filter((k) => byKind.has(k));
    const counts = kinds.map((k) => [k, (byKind.get(k) ?? []).length] as const);

    const rings: Ring[] = [];
    let radius = 108;
    let ri = 0;
    for (const kind of kinds) {
      // Worst first, so devices that need attention land on the inner rings, near the core.
      const list = (byKind.get(kind) ?? []).sort((a, b) => (worstOf(b) ? 1 : 0) - (worstOf(a) ? 1 : 0));
      let idx = 0;
      let firstOfKind = true;
      while (idx < list.length) {
        radius += firstOfKind ? 30 : 26; // a little extra breathing room between kinds
        firstOfKind = false;
        const perRing = Math.max(5, Math.floor((2 * Math.PI * radius) / arc));
        const take = Math.min(perRing, list.length - idx);
        const phase = ri * 0.7;
        const nodes: Placed[] = [];
        for (let j = 0; j < take; j++) {
          const a = (j / take) * Math.PI * 2 + phase;
          nodes.push({ d: list[idx + j], x: Math.cos(a) * radius, y: Math.sin(a) * radius, r: radius });
        }
        rings.push({ kind, radius, nodes, dur: 64 + ri * 9, dir: ri % 2 ? -1 : 1 });
        idx += take;
        ri++;
      }
    }
    return { rings, counts, size: (radius + 54) * 2 };
  }, [devices, router, worstOf, arc]);

  const half = size / 2;
  const maxR = rings.length ? rings[rings.length - 1].radius : 120;
  const moving = typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;

  const nodeEl = (p: Placed, i: number) => {
    const d = p.d;
    const worst = worstOf(d);
    const tone = toneOf(worst);
    const off = presence?.[keyOf(d)] && !presence[keyOf(d)].online;
    const sel = d.ip === selected;
    const rad = (sel ? base + 4 : worst ? base + 2.5 : base);
    const dur = (p.r / 90 + 1.6).toFixed(2);
    const begin = `${-((i * 1.7) % 3).toFixed(2)}s`;
    return (
      <g key={d.ip} transform={`translate(${half + p.x} ${half + p.y})`} opacity={dim(d) ? 0.12 : off ? 0.4 : 1}>
        {/* A faint spoke to the core; it brightens only for devices that need attention. */}
        <line x1={0} y1={0} x2={-p.x} y2={-p.y} stroke={worst ? tone : "var(--line)"} strokeWidth={worst ? 1.1 : 0.4} opacity={worst ? 0.5 : 0.12} />
        {/* Only risky devices send a packet toward the router — signal over noise. */}
        {moving && worst && !off && !dim(d) && (
          <circle r={2.1} fill={tone}>
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
          <circle r={rad} fill="var(--panel)" stroke={tone} strokeWidth={sel ? 3 : worst ? 1.8 : 1.3} style={{ filter: worst || sel ? `drop-shadow(0 0 ${worst ? 7 : 4}px ${tone})` : undefined }} />
          {showIcons && (
            <svg x={-rad * 0.52} y={-rad * 0.52} width={rad * 1.04} height={rad * 1.04} viewBox="0 0 24 24" className="pointer-events-none">
              <path d={ICON[d.kind]} fill="none" stroke={tone} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {worst && <circle className="risky-node pointer-events-none" r={rad * 0.32} fill={tone} />}
          {isNew(d) && <circle r={rad + 4} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="3 3" className="pointer-events-none" />}
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
      <defs>
        <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="core-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.16" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* A soft glow behind the whole atom. */}
      <circle cx={half} cy={half} r={maxR + 30} fill="url(#core-glow)" />

      {/* Faint orbit guides, one per ring, and a slow radar sweep. */}
      <g opacity={0.5}>
        {rings.map((s, i) => (
          <circle key={i} cx={half} cy={half} r={s.radius} fill="none" stroke="var(--line)" strokeWidth={0.6} strokeDasharray="2 8" />
        ))}
      </g>
      <line className="radar" x1={half} y1={half} x2={half + maxR} y2={half} stroke="url(#beam)" strokeWidth={2} />

      {/* Each ring is its own rotating group, turning at its own speed and direction. */}
      {rings.map((s, i) => (
        <g key={i} className="shell" style={{ animationDuration: `${s.dur}s`, animationDirection: s.dir === -1 ? "reverse" : "normal" }}>
          {s.nodes.map((p, j) => nodeEl(p, j + i))}
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
    </svg>
  );

  return (
    <>
      <MapView ref={mapRef} w={size} h={size} insets={insets}>
        {atom}
      </MapView>

      {/* The groups, listed quietly in the corner instead of floating over the map. */}
      <div data-ui className="glass pointer-events-none absolute z-10 hidden rounded-xl px-3 py-2.5 md:block" style={{ left: insets.l + 12, top: insets.t + 12 }}>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">What's orbiting</div>
        <ul className="space-y-0.5">
          {counts.map(([kind, n]) => (
            <li key={kind} className="flex items-center justify-between gap-4 font-mono text-[12px] text-muted">
              <span>{KIND_NAME[kind].toLowerCase()}</span>
              <span className="text-ink">{n}</span>
            </li>
          ))}
        </ul>
      </div>
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
