import { useEffect, useState } from "react";
import { serviceName, type LiveEvent } from "@lamplight/core";
import { connect, disconnect, EVENT_TEXT, notifyEnabled, notifySupported, parseLiveLink, rescan, setNotify, useLive } from "./live";
import { displayName, keyOf, useHome, usePlaces } from "./lib";
import { Cmd, guessOs } from "./run";
import { DeviceRow, Section, SubHeader } from "./sheets";

/** "2 min ago", "just now", "1 h ago". */
export function ago(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 20) return "just now";
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}
const span = (iso: string, now = Date.now()) => ago(iso, now).replace(" ago", "").replace("just now", "under a minute");

/** Re-renders every few seconds so "2 min ago" stays true. */
export function useTick(ms = 5000) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(i);
  }, [ms]);
  return t;
}

export const TONE: Record<LiveEvent["type"], string> = { joined: "var(--accent)", back: "var(--ok)", away: "var(--faint)", left: "var(--faint)", opened: "var(--warn)", closed: "var(--muted)", moved: "var(--muted)", scan: "var(--line)" };

export const eventDetail = (e: LiveEvent) =>
  e.type === "opened" || e.type === "closed"
    ? (e.detail ?? "")
        .split(/,\s*/)
        .filter(Boolean)
        .map((p) => serviceName({ port: Number(p), proto: "tcp" }))
        .join(", ")
    : e.detail;

/** A small chart of how fast the router and the internet answer, over the last half hour or so. */
function Pulse({ points }: { points: { at: string; routerMs?: number; internetMs?: number }[] }) {
  const W = 340;
  const H = 70;
  const recent = points.slice(-90);
  const max = Math.max(20, ...recent.map((p) => Math.max(p.routerMs ?? 0, p.internetMs ?? 0)));
  const line = (k: "routerMs" | "internetMs") =>
    recent
      .map((p, i) => (p[k] === undefined ? null : `${(i / Math.max(1, recent.length - 1)) * W},${H - ((p[k] as number) / max) * (H - 6) - 3}`))
      .filter(Boolean)
      .join(" ");
  const last = recent.at(-1);
  const lost = recent.filter((p) => p.internetMs === undefined).length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[70px] w-full" preserveAspectRatio="none" role="img" aria-label={`Internet answers in ${last?.internetMs ?? "no"} ms, router in ${last?.routerMs ?? "no"} ms`}>
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={H - f * (H - 6) - 3} y2={H - f * (H - 6) - 3} stroke="var(--line)" strokeDasharray="2 4" />
        ))}
        <polyline points={line("internetMs")} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <polyline points={line("routerMs")} fill="none" stroke="var(--ok)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 text-[12.5px] font-semibold text-muted">
        <span>
          <span className="mr-1.5 inline-block h-2 w-3 rounded-full bg-ok" />
          Router {last?.routerMs ?? "–"} ms
        </span>
        <span>
          <span className="mr-1.5 inline-block h-2 w-3 rounded-full bg-accent" />
          Internet {last?.internetMs ?? "–"} ms
        </span>
        <span className="text-faint">top of chart {Math.round(max)} ms</span>
        {lost > 0 && <span className="text-warn">{lost} missed</span>}
      </div>
    </div>
  );
}

export function LiveSheet({ onClose, onPick }: { onClose: () => void; onPick: (ip: string) => void }) {
  const lv = useLive();
  const { report } = useHome();
  const places = usePlaces();
  const now = useTick();
  const [link, setLink] = useState("");
  const [, rerender] = useState(0);
  const os = guessOs();
  const parsed = parseLiveLink(link);
  const st = lv.state;
  const presence = st?.presence ?? {};
  const online = report.devices.filter((d) => presence[keyOf(d)]?.online);
  const away = report.devices.filter((d) => presence[keyOf(d)] && !presence[keyOf(d)].online);

  if (lv.status === "off" || (lv.status === "connecting" && !st))
    return (
      <div>
        <SubHeader title="Watch it live" onClose={onClose}>
          <p className="mt-1 text-[13.5px] leading-snug text-muted">Keep the scanner running and this map updates as it happens: who joins the Wi-Fi, who leaves, what starts answering, and how fast your internet is, with a pop-up for anything new.</p>
        </SubHeader>
        {lv.status === "connecting" && (
          <p className="mt-4 flex items-center gap-2 rounded-xl bg-panel-2 p-3 text-[14px] font-semibold" role="status">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
            Connecting to the scanner on port {lv.port}…
          </p>
        )}
        {lv.error && (
          <p className="mt-3 text-[14px] font-semibold text-risk" role="alert">
            {lv.error}
          </p>
        )}
        <ol className="mt-4 space-y-4 text-[13.5px] text-muted">
          <li>
            <span className="font-semibold text-ink">1. In the folder with lamplight.cjs, start live mode.</span> Don't have it yet? See <a className="font-semibold text-accent" href="/scans">Scan your home</a>.
            <Cmd os={os}>node lamplight.cjs live</Cmd>
          </li>
          <li>
            <span className="font-semibold text-ink">2. Click the link it prints.</span> Or paste it here:
            <div className="mt-1.5 flex gap-2">
              <input className="field py-1.5 font-mono text-[12.5px]" placeholder="https://…/?live=47114&key=…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Live link" />
              <button className="btn primary shrink-0" disabled={!parsed} onClick={() => parsed && connect(parsed.port, parsed.key)}>
                Connect
              </button>
            </div>
            {link && !parsed && <p className="mt-1 text-[12.5px] text-warn">That doesn't look like the link from live mode. It ends with ?live=…&key=…</p>}
          </li>
          <li>
            <span className="font-semibold text-ink">3. If your browser asks to reach devices on your local network, allow it.</span> The site talks only to the scanner on your own computer (127.0.0.1), and only with the key from the link. Nothing leaves your house.
          </li>
        </ol>
      </div>
    );

  return (
    <div>
      <SubHeader
        title={
          <span className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${lv.status === "live" ? "animate-pulse bg-ok" : "bg-warn"}`} aria-hidden />
            {lv.status === "live" ? "Live" : "Reconnecting…"}
          </span>
        }
        onClose={onClose}
      >
        <p className="mt-1 text-[13.5px] text-muted">
          Watching {st?.network} for {st ? span(st.started, now) : "a moment"}. Quick check every 15 seconds.
        </p>
      </SubHeader>
      {lv.error && (
        <p className="mt-2 text-[13.5px] font-semibold text-warn" role="alert">
          {lv.error}
        </p>
      )}

      {st?.scanning && (
        <div className="mt-3 rounded-xl bg-panel-2 p-3" role="status">
          <div className="flex justify-between text-[13px] font-semibold">
            <span>{st.scanning.step}</span>
            <span className="tabular-nums text-muted">{st.scanning.pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${st.scanning.pct}%` }} />
          </div>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          [String(online.length), "online now"],
          [String(away.length), "away"],
          [String(lv.events.filter((e) => e.type === "joined").length), "joined"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-xl border border-line py-2">
            <dt className="sr-only">{l}</dt>
            <dd className="text-[17px] font-bold tabular-nums">{v}</dd>
            <dd className="text-[11.5px] font-semibold text-faint">{l}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn" disabled={!!st?.scanning} onClick={() => void rescan()}>
          {st?.scanning ? "Scanning…" : "Scan everything now"}
        </button>
        {notifySupported() && (
          <button
            className="btn"
            aria-pressed={notifyEnabled()}
            onClick={async () => {
              await setNotify(!notifyEnabled());
              rerender((n) => n + 1);
            }}
          >
            {notifyEnabled() ? "Pop-ups on" : "Pop-ups when a device joins"}
          </button>
        )}
        <button className="btn" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>

      {!!st?.health.length && (
        <Section title="Connection, live">
          <Pulse points={st.health} />
        </Section>
      )}

      <Section title="Activity">
        {lv.events.length ? (
          <ol className="space-y-2.5">
            {[...lv.events]
              .reverse()
              .slice(0, 60)
              .map((e) => {
                const d = report.devices.find((x) => x.ip === e.ip || (e.mac && x.mac?.toUpperCase() === e.mac.toUpperCase()));
                return (
                  <li key={e.id} className="flex gap-2.5">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TONE[e.type] }} aria-hidden />
                    <div className="min-w-0 flex-1 text-[13.5px]">
                      <span className="font-semibold">{EVENT_TEXT[e.type]}</span>
                      {e.type !== "scan" && (
                        <>
                          {eventDetail(e) ? ` ${eventDetail(e)}` : ""}:{" "}
                          {d ? (
                            <button className="font-semibold text-accent" onClick={() => onPick(d.ip)}>
                              {displayName(d, places[keyOf(d)])}
                            </button>
                          ) : (
                            <span className="font-mono">{e.name ?? e.ip}</span>
                          )}
                        </>
                      )}
                      {e.type === "scan" && <span className="text-muted">, {e.detail}</span>}
                    </div>
                    <time className="shrink-0 text-[12px] text-faint" dateTime={e.at} title={new Date(e.at).toLocaleString()}>
                      {ago(e.at, now)}
                    </time>
                  </li>
                );
              })}
          </ol>
        ) : (
          <p className="text-[13.5px] text-muted">Nothing yet. Turn a phone's Wi-Fi off and on to see it here within a minute.</p>
        )}
      </Section>

      {online.length > 0 && (
        <Section title="Online now">
          <ul className="space-y-0.5">
            {online.map((d) => (
              <li key={d.ip}>
                <DeviceRow d={d} onPick={onPick} note={`on for ${span(presence[keyOf(d)].since, now)}`} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {away.length > 0 && (
        <Section title="Away">
          <ul className="space-y-0.5 opacity-75">
            {away.map((d) => (
              <li key={d.ip}>
                <DeviceRow d={d} onPick={onPick} note={`last seen ${ago(presence[keyOf(d)].lastSeen, now)}`} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
