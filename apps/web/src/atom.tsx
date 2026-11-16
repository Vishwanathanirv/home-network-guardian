import { useMemo, useState } from "react";
import { KIND_NAME, type DeviceReport, type Kind, type Severity } from "@lamplight/core";
import { activity, displayName, keyOf, realName, usePlaces, usePresence } from "./lib";
import { ICON, toneOf } from "./plan";
import { MapView, type MapHandle } from "./MapView";
import type { Ref } from "react";

/* The network as a little universe. The router is an arc-reactor core; every device is a star,
 * scattered loosely through space in clusters of its own kind, like constellations, with its name
 * under it when it told us one. Drag to fly around, pinch or double-tap to zoom in. Devices that
 * need attention burn amber or red, pulse, and send packets to the core. */

const ORDER: Kind[] = ["phone", "computer", "tv", "speaker", "console", "camera", "printer", "nas", "smart", "unknown"];

// Each kind of device glows its own colour, so the map reads like a sky of different stars.
const KIND_TONE: Partial<Record<Kind, string>> = {
  phone: "#7db8e6",
  computer: "#8ad8ff",
  tv: "#b79cff",
  speaker: "#6ee7c7",
  console: "#ff9ccf",
  camera: "#ffcf6e",
  printer: "#9fb3c8",
  nas: "#7cf3a0",
  smart: "#5fd0e6",
  unknown: "#5f748c", // dim, distant
};

const GOLDEN = 2.399963; // the sunflower angle: spreads points evenly without any rings
const CHUNK = 36; // a big crowd of one kind splits into several smaller clusters

type Star = { d: DeviceReport; x: number; y: number; c: number; drift: number; room: number };
type Cluster = { kind: Kind; first: boolean; n: number; x: number; y: number; top: number; links: [number, number][] };

// A tiny deterministic random, so the universe looks the same every time you open it.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261);

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

  // Stars shrink as the crowd grows, so a big network reads as a galaxy, not a blob.
  const count = devices.length;
  const base = count > 120 ? 6 : count > 60 ? 7.5 : count > 30 ? 9.5 : 12;
  const showIcons = base >= 9.5;
  const gap = base * 2 + 14; // the closest two stars may sit
  // Only a real problem (amber or red) counts; a harmless note keeps the star its own colour.
  const hot = (d: DeviceReport) => {
    const s = worstOf(d);
    return toneOf(s) === "var(--ok)" ? null : s;
  };

  const { stars, clusters, counts, w, h, cx, cy } = useMemo(() => {
    const rest = devices.filter((d) => d !== router);
    const byKind = new Map<Kind, DeviceReport[]>();
    for (const d of rest) byKind.set(d.kind, [...(byKind.get(d.kind) ?? []), d]);
    const kinds = ORDER.filter((k) => byKind.has(k));
    const counts = kinds.map((k) => [k, (byKind.get(k) ?? []).length] as const);
    const rand = rng(hash(rest.map((d) => d.ip).join(",")) || 1);

    // 1. Break each kind into clusters and drop each cluster somewhere in space around the core.
    const stars: Star[] = [];
    const clusters: Cluster[] = [];
    let ci = 0;
    for (const kind of kinds) {
      const list = [...(byKind.get(kind) ?? [])].sort((a, b) => (hot(b) ? 1 : 0) - (hot(a) ? 1 : 0));
      for (let s = 0; s < list.length; s += CHUNK) {
        const part = list.slice(s, s + CHUNK);
        const spread = gap * 0.62 * Math.sqrt(part.length) + 10;
        const angle = ci * GOLDEN + (rand() - 0.5) * 0.9;
        const dist = Math.max(110 + spread, 110 + Math.sqrt(ci + 1) * 100 + rand() * 70);
        const ox = Math.cos(angle) * dist;
        const oy = Math.sin(angle) * dist * 0.82; // a slightly flattened galaxy
        part.forEach((d, j) => {
          const r = gap * 0.62 * Math.sqrt(j + 0.5) * (0.8 + rand() * 0.45);
          const a = j * GOLDEN + rand() * 0.8;
          // A star with a name needs room for its label, so its neighbours keep further away.
          const name = realName(d, places[keyOf(d)]);
          const room = name ? Math.max(gap / 2, Math.min(name.length, 22) * 3.2 + 6) : gap / 2;
          stars.push({ d, x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r, c: ci, drift: rand(), room });
        });
        clusters.push({ kind, first: s === 0, n: list.length, x: ox, y: oy, top: 0, links: [] });
        ci++;
      }
    }

    // 2. Nudge stars apart so none touch, and keep them clear of the core.
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < stars.length; i++) {
        const a = stars[i];
        for (let j = i + 1; j < stars.length; j++) {
          const b = stars[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dd = dx * dx + dy * dy;
          const need = a.room + b.room;
          if (dd < need * need && dd > 0.0001) {
            const dist = Math.sqrt(dd);
            const push = (need - dist) / 2 / dist;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
          }
        }
        const dc = Math.hypot(a.x, a.y);
        if (dc < 100) {
          const k = 100 / Math.max(dc, 0.001);
          a.x *= k;
          a.y *= k;
        }
      }
    }

    // 3. Faint constellation lines: each star joins the nearest earlier star of its own cluster.
    clusters.forEach((cl, k) => {
      const idx = stars.map((s, i) => (s.c === k ? i : -1)).filter((i) => i >= 0);
      cl.top = Math.min(...idx.map((i) => stars[i].y)) - base - 16;
      cl.x = idx.reduce((s, i) => s + stars[i].x, 0) / idx.length;
      for (let m = 1; m < idx.length; m++) {
        let best = idx[0];
        let bd = Infinity;
        for (let q = 0; q < m; q++) {
          const dd = (stars[idx[m]].x - stars[idx[q]].x) ** 2 + (stars[idx[m]].y - stars[idx[q]].y) ** 2;
          if (dd < bd) {
            bd = dd;
            best = idx[q];
          }
        }
        if (bd < (gap * 2.4) ** 2) cl.links.push([best, idx[m]]);
      }
    });

    const pad = 90;
    const maxX = Math.max(160, ...stars.map((s) => Math.abs(s.x))) + pad;
    const maxY = Math.max(160, ...stars.map((s) => Math.abs(s.y)), ...clusters.map((c) => Math.abs(c.top))) + pad;
    return { stars, clusters, counts, w: maxX * 2, h: maxY * 2, cx: maxX, cy: maxY };
  }, [devices, router, worstOf, gap, base, places]);

  // The core burns amber or red too when the router itself has a real problem.
  const routerHot = router ? hot(router) : null;
  const coreTone = routerHot ? toneOf(routerHot) : "var(--accent)";
  const moving = typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;

  // A field of distant background stars.
  const dust = useMemo(() => {
    const r = rng(Math.round(w * 7 + h));
    const n = Math.min(320, Math.round((w * h) / 5200));
    return Array.from({ length: n }, (_, i) => ({ x: r() * w, y: r() * h, rad: 0.3 + r() * 1.2, op: 0.1 + r() * 0.5, tw: i % 7 === 0, dur: (2 + r() * 4).toFixed(1) }));
  }, [w, h]);

  const starEl = (s: Star, i: number) => {
    const d = s.d;
    const worst = hot(d);
    const calm = KIND_TONE[d.kind] ?? "var(--accent)";
    const tone = worst ? toneOf(worst) : calm;
    const off = presence?.[keyOf(d)] && !presence[keyOf(d)].online;
    const sel = d.ip === selected;
    const rad = sel ? base + 4 : worst ? base + 2.5 : base;
    const x = cx + s.x;
    const y = cy + s.y;
    const pdur = (Math.hypot(s.x, s.y) / 90 + 1.6).toFixed(2);
    const begin = `${-((i * 1.7) % 3).toFixed(2)}s`;
    const label = realName(d, places[keyOf(d)]);
    return (
      <g key={d.ip} opacity={dim(d) ? 0.12 : off ? 0.4 : 1}>
        {/* Only devices that need attention reach back to the core, with a packet riding the line. */}
        {worst && <line x1={x} y1={y} x2={cx} y2={cy} stroke={tone} strokeWidth={1} opacity={0.45} />}
        {moving && worst && !off && !dim(d) && (
          <circle r={2.1} fill={tone}>
            <animateMotion path={`M${x} ${y} L${cx} ${cy}`} dur={`${pdur}s`} begin={begin} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;0.9;0" keyTimes="0;0.15;0.7;1" dur={`${pdur}s`} begin={begin} repeatCount="indefinite" />
          </circle>
        )}
        <g className={moving ? "float" : undefined} style={moving ? { animationDuration: `${(7 + s.drift * 6).toFixed(1)}s`, animationDelay: `${(-s.drift * 9).toFixed(1)}s` } : undefined}>
          <g
            transform={`translate(${x} ${y})`}
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
            {(worst || sel) && <circle r={rad + 4} fill="none" stroke={tone} strokeWidth={0.8} opacity={0.5} />}
            <circle r={rad} fill="var(--panel)" stroke={tone} strokeWidth={sel ? 3 : worst ? 1.8 : 1.3} style={{ filter: `drop-shadow(0 0 ${worst ? 7 : sel ? 5 : 2.5}px ${tone})` }} />
            {showIcons && (
              <svg x={-rad * 0.52} y={-rad * 0.52} width={rad * 1.04} height={rad * 1.04} viewBox="0 0 24 24" className="pointer-events-none">
                <path d={ICON[d.kind]} fill="none" stroke={tone} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {worst && <circle className="risky-node pointer-events-none" r={rad * 0.32} fill={tone} />}
            {isNew(d) && <circle r={rad + 6} fill="none" stroke="var(--accent)" strokeWidth={1.2} strokeDasharray="3 3" className="pointer-events-none" />}
            {label && (
              <text y={rad + 11} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={9.5} stroke="var(--bg)" strokeWidth={3} paintOrder="stroke" fill="var(--ink)" className="pointer-events-none">
                {label.length > 22 ? label.slice(0, 21) + "…" : label}
              </text>
            )}
          </g>
        </g>
      </g>
    );
  };

  const atom = (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className={`block select-none overflow-visible ${frozen ? "atom-paused" : ""}`} onPointerLeave={() => { setFrozen(false); setHover(null); }} role="group" aria-label="Your network as an atom">
      <defs>
        <radialGradient id="space" cx="0.5" cy="0.5" r="0.75">
          <stop offset="0" stopColor="#0e1821" />
          <stop offset="0.55" stopColor="#0a1016" />
          <stop offset="1" stopColor="#070b0f" />
        </radialGradient>
        <radialGradient id="neb-a" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#2b6ea8" stopOpacity="0.22" />
          <stop offset="1" stopColor="#2b6ea8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="neb-b" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#8a5cff" stopOpacity="0.16" />
          <stop offset="1" stopColor="#8a5cff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="core-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.2" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Deep space, two nebula clouds, and distant dust. */}
      <rect x={-w} y={-h} width={w * 3} height={h * 3} fill="url(#space)" />
      <ellipse cx={w * 0.3} cy={h * 0.35} rx={w * 0.34} ry={h * 0.26} fill="url(#neb-a)" />
      <ellipse cx={w * 0.72} cy={h * 0.66} rx={w * 0.36} ry={h * 0.3} fill="url(#neb-b)" />
      {dust.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.rad} fill="#cfe4ff" opacity={s.op} className={moving && s.tw ? "twinkle" : undefined} style={moving && s.tw ? { animationDuration: `${s.dur}s` } : undefined} />
      ))}
      <circle cx={cx} cy={cy} r={150} fill="url(#core-glow)" />

      {/* Constellations: faint lines inside each cluster, and the cluster's name above it. */}
      <g stroke="var(--line)" strokeWidth={0.7} opacity={0.55}>
        {clusters.flatMap((cl) => cl.links.map(([a, b]) => <line key={`${a}-${b}`} x1={cx + stars[a].x} y1={cy + stars[a].y} x2={cx + stars[b].x} y2={cy + stars[b].y} />))}
      </g>
      {clusters.map((cl, i) =>
        cl.first ? (
          <text key={i} x={cx + cl.x} y={cy + cl.top} textAnchor="middle" fontSize={12} className="pointer-events-none" fill="var(--muted)" opacity={0.75} stroke="var(--bg)" strokeWidth={3} paintOrder="stroke">
            {KIND_NAME[cl.kind].toLowerCase()} <tspan fill="var(--faint)">{cl.n}</tspan>
          </text>
        ) : null,
      )}

      {stars.map((s, i) => starEl(s, i))}

      {/* The arc-reactor core: the router. */}
      {moving && [0, 1, 2].map((n) => (
        <circle key={n} className="nucleus-ring" cx={cx} cy={cy} r={30} fill="none" stroke="var(--accent)" strokeWidth={1.5} style={{ animationDelay: `${n}s` }} />
      ))}
      <g className="shell" style={{ animationDuration: "26s", transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={46} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeDasharray="11 9" opacity={0.5} />
      </g>
      <g className="shell" style={{ animationDuration: "38s", animationDirection: "reverse", transformOrigin: `${cx}px ${cy}px` }}>
        <circle cx={cx} cy={cy} r={38} fill="none" stroke="var(--ok)" strokeWidth={1} strokeDasharray="2 10" opacity={0.45} />
      </g>
      <g transform={`translate(${cx} ${cy})`} className="cursor-pointer" role="button" tabIndex={0} aria-label={`Your router and network${routerHot ? ", needs attention" : ""}`} data-device={router?.ip} onClick={onNucleus} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onNucleus())}>
        <circle r={44} fill="var(--accent)" opacity={0.07} />
        <circle r={30} fill="var(--panel)" stroke={coreTone} strokeWidth={2} style={{ filter: `drop-shadow(0 0 16px ${coreTone})` }} />
        {routerHot && <circle className="risky-node pointer-events-none" cx={21} cy={-21} r={4} fill={coreTone} />}
        <svg x={-15} y={-15} width={30} height={30} viewBox="0 0 24 24" className="pointer-events-none">
          <path d={ICON.router} fill="none" stroke={coreTone} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <text y={58} textAnchor="middle" className="fill-[var(--muted)] font-mono text-[12px]" stroke="var(--bg)" strokeWidth={3} paintOrder="stroke">
          {devices.length} devices
        </text>
      </g>
    </svg>
  );

  return (
    <>
      <MapView ref={mapRef} w={w} h={h} insets={insets}>
        {atom}
      </MapView>

      {/* What's out there, listed quietly in the corner. */}
      <div data-ui className="glass pointer-events-none absolute z-10 hidden rounded-xl px-3 py-2.5 md:block" style={{ left: insets.l + 12, top: insets.t + 12 }}>
        <div className="mb-1 text-[12px] font-semibold text-faint">In your universe</div>
        <ul className="space-y-0.5">
          {counts.map(([kind, n]) => (
            <li key={kind} className="flex items-center justify-between gap-4 font-mono text-[12px] text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: KIND_TONE[kind] ?? "var(--accent)" }} />
                {KIND_NAME[kind].toLowerCase()}
              </span>
              <span className="text-ink">{n}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 text-[11.5px] text-faint">Drag to fly, pinch or scroll to zoom</div>
      </div>
      {hover && (
        <div data-ui className="pointer-events-none fixed z-30 w-[15rem] -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-xl border border-line bg-panel p-3 shadow-[var(--shadow)]" style={{ left: hover.x, top: hover.y }}>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: hot(hover.d) ? toneOf(hot(hover.d)) : (KIND_TONE[hover.d.kind] ?? "var(--accent)") }} />
            <span className="truncate font-semibold">{displayName(hover.d, places[keyOf(hover.d)])}</span>
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            {KIND_NAME[hover.d.kind]}
            {hover.d.details?.model ? `, ${hover.d.details.model}` : ""}
          </div>
          <div className="mt-1 font-mono text-[11.5px] text-faint">{hover.d.ip}</div>
          <div className="mt-1.5 text-[12.5px]">
            <span className="text-faint">Doing: </span>
            {activity(hover.d)}
          </div>
          {hot(hover.d) && <div className="mt-1 text-[12.5px] font-semibold text-risk">{hover.d.issues.filter((i) => i.severity !== "info").length} to fix, tap to open</div>}
        </div>
      )}
    </>
  );
}
