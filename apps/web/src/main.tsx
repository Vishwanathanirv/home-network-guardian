import { StrictMode, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate, useSearchParams } from "react-router";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/red-hat-mono";
import "./index.css";
import { KIND_NAME, SEVERITY_RANK, type DeviceReport, type Severity } from "@lamplight/core";
import { DeviceSheet } from "./device";
import { displayName, issueKey, keyOf, roomFor, ROOMS, useDone, useHome, usePlaces, usePresence } from "./lib";
import { dismiss, EVENT_TEXT, resume, useLive } from "./live";
import { eventDetail, LiveSheet, TONE } from "./livesheet";
import { Palette, type Action } from "./palette";
import { DeviceTable } from "./table";
import { MapView, type MapHandle } from "./MapView";
import { FloorPlan, layout, planHeight, W } from "./plan";
import { NetworkSheet } from "./network";
import { ScansSheet } from "./run";
import { ChangesSheet, DeviceRow, HomeSheet, HowSheet } from "./sheets";

const useMedia = (q: string) =>
  useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(q);
      m.addEventListener("change", l);
      return () => m.removeEventListener("change", l);
    },
    () => window.matchMedia(q).matches,
  );

const FILTERS = [
  { id: "tonight", t: "Needs you tonight" },
  { id: "week", t: "This week" },
  { id: "new", t: "New" },
  { id: "unknown", t: "To identify" },
  { id: "fine", t: "Fine" },
] as const;
type Filter = (typeof FILTERS)[number]["id"];

type Detent = "peek" | "half" | "full";
const detentPx = (d: Detent, vh: number) => (d === "peek" ? 238 : d === "half" ? Math.round(vh * 0.5) : vh - 76);

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

resume();

function App() {
  const { report, isNew } = useHome();
  const lv = useLive();
  const presence = usePresence();
  const [view, setViewState] = useState<"map" | "table">(() => {
    try {
      return localStorage.getItem("lamplight-view") === "table" ? "table" : "map";
    } catch {
      return "map";
    }
  });
  const setView = (v: "map" | "table") => {
    setViewState(v);
    try {
      localStorage.setItem("lamplight-view", v);
    } catch {
      /* ignore */
    }
  };
  const [palette, setPalette] = useState(false);
  const places = usePlaces();
  const done = useDone();
  const [params] = useSearchParams();
  const loc = useLocation();
  const navigate = useNavigate();
  const wide = useMedia("(min-width: 768px)");
  const map = useRef<MapHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [detent, setDetent] = useState<Detent>("peek");
  const [dragH, setDragH] = useState<number | null>(null);
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => {
    const r = () => setVh(window.innerHeight);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  // What's still to do on each device, so ticking a problem off changes the plan at once.
  const leftOf = (d: DeviceReport) => d.issues.filter((i) => i.severity !== "info" && !done[issueKey(keyOf(d), i)]);
  const worstOf = (d: DeviceReport): Severity | null => leftOf(d).reduce<Severity | null>((w, i) => (!w || SEVERITY_RANK[i.severity] > SEVERITY_RANK[w] ? i.severity : w), null);

  const selected = params.get("device") ?? undefined;
  const device = report.devices.find((x) => x.ip === selected);
  const page = loc.pathname.replace(/\/$/, "") || "/";

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle && !filter) return null;
    return report.devices.filter((d) => {
      const saved = places[keyOf(d)];
      const room = ROOMS.find((r) => r.id === roomFor(d, saved));
      if (filter) {
        const w = worstOf(d);
        if (filter === "tonight" && !(w && SEVERITY_RANK[w] >= 3)) return false;
        if (filter === "week" && w !== "medium") return false;
        if (filter === "new" && !isNew(d)) return false;
        if (filter === "unknown" && room) return false;
        if (filter === "fine" && w) return false;
      }
      if (!needle) return true;
      const hay = [displayName(d, saved), d.hostname, d.vendor, d.ip, d.mac, KIND_NAME[d.kind], room?.name ?? "doorstep", ...d.issues.map((i) => i.title)].filter(Boolean).join(" ").toLowerCase();
      return needle.split(/\s+/).every((w) => hay.includes(w));
    });
  }, [q, filter, report, places, done, isNew]);
  const hit = matches ? new Set(matches.map((d) => d.ip)) : null;

  const pos = useMemo(() => new Map(layout(report.devices, places).map((p) => [p.d.ip, p])), [report, places]);
  const height = planHeight([...pos.values()].filter((p) => !p.room).length) + 24;

  const pick = (ip: string) => {
    navigate(`/?device=${encodeURIComponent(ip)}`);
    if (!wide && detent === "peek") setDetent("half");
  };
  // Fly to the device whenever one is opened, from the plan, a list or the address bar.
  useEffect(() => {
    const p = selected && pos.get(selected);
    if (p) requestAnimationFrame(() => map.current?.focus(p.x + 12, p.y + 12));
    if (selected && !wide) setDetent((x) => (x === "peek" ? "half" : x));
  }, [selected]);

  const close = () => {
    navigate("/");
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((x) => !x);
        return;
      }
      if (palette) return;
      const typing = (e.target as HTMLElement).closest("input,textarea,select");
      if (e.key === "Escape") {
        if (q || filter) {
          setQ("");
          setFilter(null);
        } else if (page !== "/" || selected) navigate("/");
        search.current?.blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        search.current?.focus();
      } else if (e.key === "+" || e.key === "=") map.current?.zoomBy(1.4);
      else if (e.key === "-") map.current?.zoomBy(1 / 1.4);
      else if (e.key === "0") map.current?.fit();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  const sheetH = dragH ?? detentPx(detent, vh);
  const insets = wide ? { l: 408, t: 12, r: 64, b: 12 } : { l: 0, t: 116, r: 0, b: detent === "peek" ? detentPx("peek", vh) : detentPx("half", vh) };

  let body;
  if (device) body = <DeviceSheet key={device.ip} d={device} isNew={isNew(device)} onClose={close} />;
  else if (page === "/changes") body = <ChangesSheet onClose={close} onPick={pick} />;
  else if (page === "/scans") body = <ScansSheet onClose={close} />;
  else if (page === "/network") body = <NetworkSheet onClose={close} onPick={pick} />;
  else if (page === "/how") body = <HowSheet onClose={close} />;
  else if (page === "/live") body = <LiveSheet onClose={close} onPick={pick} />;
  else if (matches)
    body = (
      <div>
        <div className="flex items-baseline justify-between">
          <h1 className="text-[1.25rem] font-bold">{matches.length ? `${matches.length} device${matches.length === 1 ? "" : "s"}` : "No devices match"}</h1>
          <button
            className="text-[13.5px] font-semibold text-accent"
            onClick={() => {
              setQ("");
              setFilter(null);
            }}
          >
            Clear
          </button>
        </div>
        {!matches.length && <p className="mt-2 text-[14.5px] text-muted">Try a name, a maker, a room or an address, like "camera", "kitchen" or "192.168.1.31".</p>}
        <ul className="mt-2 space-y-0.5">
          {matches.map((d) => (
            <li key={d.ip}>
              <DeviceRow d={d} onPick={pick} left={leftOf(d).length} />
            </li>
          ))}
        </ul>
      </div>
    );
  else body = <HomeSheet onPick={pick} compact={!wide && detent === "peek"} />;

  const searchBar = (
    <div className="glass flex h-12 shrink-0 items-center gap-2 rounded-2xl px-3.5">
      <Icon d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" className="h-[18px] w-[18px] shrink-0 text-faint" />
      <input
        ref={search}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          if (selected || page !== "/") navigate("/");
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches?.[0]) pick(matches[0].ip);
        }}
        onFocus={() => !wide && detent === "peek" && setDetent("half")}
        placeholder="Search devices, rooms, problems"
        aria-label="Search devices, rooms and problems"
        className="h-full min-w-0 flex-1 bg-transparent text-[15.5px] outline-none placeholder:text-faint"
      />
      {q ? (
        <button className="grid h-6 w-6 place-items-center rounded-full bg-faint text-panel" onClick={() => setQ("")} aria-label="Clear the search">
          <Icon d="M7 7l10 10M17 7L7 17" className="h-3.5 w-3.5" />
        </button>
      ) : (
        wide && <span className="rounded-md border border-line px-1.5 font-mono text-[11px] text-faint">/</span>
      )}
    </div>
  );
  const chips = (
    <div className={`flex shrink-0 gap-1.5 ${wide ? "flex-wrap" : "-mx-3 overflow-x-auto px-3 pb-1 [scrollbar-width:none]"}`} role="group" aria-label="Show only">
      {FILTERS.map((f) => {
        const on = filter === f.id;
        return (
          <button
            key={f.id}
            aria-pressed={on}
            onClick={() => {
              setFilter(on ? null : f.id);
              if (selected || page !== "/") navigate("/");
              if (!wide && detent === "peek") setDetent("half");
            }}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-[13.5px] font-semibold shadow-[var(--shadow)] backdrop-blur ${on ? "border-ink bg-ink text-bg" : "border-line bg-[var(--chip)] text-ink hover:border-faint"}`}
          >
            {f.t}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="relative h-dvh overflow-hidden">
      <MapView ref={map} w={W + 24} h={height} insets={insets}>
        <FloorPlan devices={report.devices} selected={selected} onSelect={pick} isNew={isNew} worstOf={worstOf} open={(d) => leftOf(d).length} dim={(d) => !!hit && !hit.has(d.ip)} away={(d) => !!presence?.[keyOf(d)] && !presence[keyOf(d)].online} />
      </MapView>

      {view === "table" && (
        <section data-ui aria-label="All devices" className={`glass rise absolute z-[15] rounded-2xl ${wide ? "bottom-3 left-[408px] right-[4.5rem] top-3" : "inset-x-3 top-[7.25rem]"}`} style={{ background: "var(--panel)", ...(wide ? {} : { bottom: sheetH + 8 }) }}>
          <DeviceTable devices={matches ?? report.devices} left={leftOf} onPick={pick} selected={selected} />
        </section>
      )}

      {/* Live: what just happened, as it happens. */}
      {lv.fresh.length > 0 && (
        <div data-ui className={`absolute z-40 flex flex-col gap-2 ${wide ? "bottom-14 left-1/2 w-[24rem] -translate-x-1/2" : "inset-x-3 top-[7.25rem]"}`} role="status" aria-live="polite">
          {lv.fresh.slice(-3).map((e) => (
            <Toast key={e.id} id={e.id} onOpen={() => {
              const d = report.devices.find((x) => x.ip === e.ip || (e.mac && x.mac?.toUpperCase() === e.mac.toUpperCase()));
              if (d) pick(d.ip);
              dismiss(e.id);
            }}>
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE[e.type] }} aria-hidden />
              <span className="min-w-0 flex-1 text-[13.5px]">
                <span className="font-semibold">{EVENT_TEXT[e.type]}{eventDetail(e) ? ` ${eventDetail(e)}` : ""}</span>
                <span className="block truncate text-muted">{e.name ?? "Unknown device"}, {e.ip}</span>
              </span>
            </Toast>
          ))}
        </div>
      )}

      <Palette
        open={palette}
        onClose={() => setPalette(false)}
        devices={report.devices}
        onPick={pick}
        actions={
          [
            { id: "live", t: lv.status === "off" ? "Watch it live" : "Live activity", hint: "join leave alerts real time", run: () => navigate("/live") },
            { id: "network", t: "Your network", hint: "grade internet speed router doors upnp report", run: () => navigate("/network") },
            { id: "table", t: view === "table" ? "Show the plan" : "Show all devices as a table", hint: "list csv sort", run: () => setView(view === "table" ? "map" : "table") },
            { id: "scan", t: "Scan your home", hint: "commands terminal cmd", run: () => navigate("/scans") },
            { id: "changes", t: "What changed", hint: "joined compare", run: () => navigate("/changes") },
            { id: "fit", t: "Show the whole house", hint: "zoom fit", run: () => map.current?.fit() },
            ...FILTERS.map((f) => ({ id: `f-${f.id}`, t: `Show only: ${f.t}`, hint: "filter", run: () => setFilter(f.id) })),
            { id: "how", t: "How it works", hint: "help", run: () => navigate("/how") },
          ] satisfies Action[]
        }
      />

      {/* Map controls, top right like any maps app. */}
      <button
        data-ui
        onClick={() => navigate("/live")}
        className={`glass absolute z-10 flex items-center gap-2 rounded-full px-3.5 text-[13.5px] font-semibold ${wide ? "right-[4.5rem] top-3 h-10" : "right-3 top-[7.5rem] hidden"}`}
        aria-label={lv.status === "live" ? "Live: open activity" : "Watch it live"}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${lv.status === "live" ? "animate-pulse bg-ok" : lv.status === "off" ? "bg-faint" : "animate-pulse bg-warn"}`} aria-hidden />
        {lv.status === "live" ? `Live, ${Object.values(presence ?? {}).filter((p) => p.online).length} online` : lv.status === "off" ? "Go live" : "Connecting…"}
      </button>
      {wide && (
        <button data-ui onClick={() => setPalette(true)} className="glass absolute right-[4.5rem] top-[3.75rem] z-10 flex h-9 items-center gap-2 rounded-full px-3 text-[12.5px] font-semibold text-muted hover:text-ink" aria-label="Go to anything (Ctrl K)">
          Go to <span className="rounded-md border border-line px-1.5 font-mono text-[11px]">Ctrl K</span>
        </button>
      )}
      <div data-ui className={`absolute right-3 z-10 flex flex-col gap-2 ${wide ? "top-3" : "top-[7.5rem]"}`}>
        <div className={`glass flex-col overflow-hidden rounded-xl ${wide ? "flex" : "hidden"}`}>
          <button className="mapbtn" onClick={() => map.current?.zoomBy(1.4)} aria-label="Zoom in" title="Zoom in (+)">
            <Icon d="M12 5v14M5 12h14" />
          </button>
          <span className="mx-2 h-px bg-line" />
          <button className="mapbtn" onClick={() => map.current?.zoomBy(1 / 1.4)} aria-label="Zoom out" title="Zoom out (−)">
            <Icon d="M5 12h14" />
          </button>
        </div>
        {!wide && (
          <button className="glass mapbtn relative rounded-xl" onClick={() => navigate("/live")} aria-label={lv.status === "live" ? "Live: open activity" : "Watch it live"} title="Live">
            <Icon d="M5 12a7 7 0 0 1 14 0M8.5 12a3.5 3.5 0 0 1 7 0M12 12h.01" />
            {lv.status !== "off" && <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${lv.status === "live" ? "bg-ok" : "bg-warn"}`} />}
          </button>
        )}
        <button className="glass mapbtn rounded-xl" onClick={() => setView(view === "table" ? "map" : "table")} aria-label={view === "table" ? "Show the plan" : "Show all devices as a table"} aria-pressed={view === "table"} title={view === "table" ? "Show the plan" : "Table"}>
          <Icon d={view === "table" ? "M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13" : "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14"} />
        </button>
        <button className="glass mapbtn rounded-xl" onClick={() => map.current?.fit()} aria-label="Show the whole house" title="Show the whole house (0)">
          <Icon d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
        </button>
        <button className="glass mapbtn rounded-xl" onClick={() => navigate("/network")} aria-label="Your network" title="Your network">
          <Icon d="M12 3v4M5 21v-4h14v4M12 13V7M5 17v-4h14v4M9 3h6v4H9z" />
        </button>
        <button className="glass mapbtn rounded-xl" onClick={() => navigate("/scans")} aria-label="Scan your home: commands" title="Scan your home: commands">
          <Icon d="M4 17l6-6-6-6M12 19h8" />
        </button>
      </div>

      {wide ? (
        <>
          <div data-ui className="absolute bottom-3 left-3 top-3 z-20 flex w-[384px] flex-col gap-2">
            {searchBar}
            {chips}
            <section className="glass rise scroll-y mt-1 min-h-0 rounded-2xl p-4" aria-label="Details">
              {body}
            </section>
          </div>
          <div data-ui className="glass absolute bottom-3 right-3 z-10 flex items-center gap-3 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold text-muted">
            {[
              ["var(--ok)", "Fine"],
              ["var(--warn)", "This week"],
              ["var(--risk)", "Tonight"],
            ].map(([c, t]) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: c }} />
                {t}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-accent" />
              New
            </span>
            <span className="text-faint">Drag a device to its room</span>
          </div>
        </>
      ) : (
        <>
          <div data-ui className="absolute inset-x-3 top-3 z-20 flex flex-col gap-2">
            {searchBar}
            {chips}
          </div>
          <section
            data-ui
            aria-label="Details"
            className="glass fixed inset-x-0 bottom-0 z-30 flex flex-col rounded-t-[22px] border-b-0"
            style={{ height: sheetH, background: "var(--panel)", transition: dragH === null ? "height 0.28s cubic-bezier(.2,.8,.2,1)" : undefined }}
          >
            <button
              className="flex h-6 shrink-0 touch-none items-center justify-center"
              aria-label={detent === "full" ? "Make the sheet smaller" : "Make the sheet bigger"}
              onClick={() => setDetent(detent === "peek" ? "half" : detent === "half" ? "full" : "peek")}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const start = e.clientY;
                const h0 = sheetH;
                const el = e.currentTarget;
                let moved = false;
                const move = (ev: PointerEvent) => {
                  if (Math.abs(ev.clientY - start) > 4) moved = true;
                  setDragH(Math.max(120, Math.min(vh - 60, h0 + start - ev.clientY)));
                };
                const up = (ev: PointerEvent) => {
                  el.removeEventListener("pointermove", move);
                  el.removeEventListener("pointerup", up);
                  if (moved) {
                    const h = h0 + start - ev.clientY;
                    const best = (["peek", "half", "full"] as Detent[]).reduce((a, b) => (Math.abs(detentPx(b, vh) - h) < Math.abs(detentPx(a, vh) - h) ? b : a));
                    setDetent(best);
                    // Don't let the click that follows a drag toggle the size again.
                    el.addEventListener("click", (c) => c.stopPropagation(), { once: true, capture: true });
                  }
                  setDragH(null);
                };
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", up);
              }}
            >
              <span className="h-1.5 w-10 rounded-full bg-faint opacity-60" />
            </button>
            <div className="scroll-y min-h-0 flex-1 px-4 pb-6">{body}</div>
          </section>
        </>
      )}
    </div>
  );
}

function Toast({ id, children, onOpen }: { id: number; children: ReactNode; onOpen: () => void }) {
  useEffect(() => {
    const t = setTimeout(() => dismiss(id), 7000);
    return () => clearTimeout(t);
  }, [id]);
  return (
    <div className="glass rise flex items-start gap-2.5 rounded-2xl p-3">
      <button className="flex min-w-0 flex-1 items-start gap-2.5 text-left" onClick={onOpen}>
        {children}
      </button>
      <button className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-faint hover:text-ink" onClick={() => dismiss(id)} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
