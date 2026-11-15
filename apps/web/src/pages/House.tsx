import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { KIND_NAME, serviceName, SEVERITY_RANK, type DeviceReport, type Issue, type Severity } from "@lamplight/core";
import { displayName, keyOf, place, roomFor, ROOMS, useHome, usePlaces } from "../lib";
import { FloorPlan, ICON, toneOf } from "../plan";

const WHEN: Record<Severity, string> = { critical: "Tonight", high: "Tonight", medium: "This week", low: "When you have a minute", info: "For your information" };

function Pip({ s }: { s: Severity }) {
  return <span className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: toneOf(s), boxShadow: `0 0 calc(var(--glow, 0) * 8px) ${toneOf(s)}` }} aria-hidden />;
}

function Steps({ issue }: { issue: Issue }) {
  return (
    <div>
      <p className="text-[15px] leading-relaxed text-muted">{issue.why}</p>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
        {issue.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

/** The to-do list, grouped by how soon to do it. */
function Tonight({ issues, devices, onPick }: { issues: Issue[]; devices: DeviceReport[]; onPick: (ip: string) => void }) {
  const places = usePlaces();
  const [open, setOpen] = useState<string | null>(null);
  const groups = (["Tonight", "This week", "When you have a minute"] as const).map((g) => [g, issues.filter((i) => WHEN[i.severity] === g)] as const).filter(([, l]) => l.length);
  if (!groups.length) return <p className="text-muted">Nothing to fix. Every device looks fine.</p>;
  return (
    <div className="space-y-6">
      {groups.map(([g, list]) => (
        <section key={g}>
          <h2 className="text-[13px] font-bold text-faint">{g}</h2>
          <ul className="mt-2 space-y-2">
            {list.map((i, n) => {
              const d = devices.find((x) => x.ip === i.ip);
              const id = `${i.id}-${i.ip}-${n}`;
              const isOpen = open === id;
              return (
                <li key={id} className="card">
                  <button className="flex w-full gap-3 p-3 text-left" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
                    <Pip s={i.severity} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold leading-snug">{i.title}</span>
                      <span className="block text-sm text-muted">{d ? displayName(d, places[keyOf(d)]) : "Your whole network"}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-line px-3 pb-3 pt-2">
                      <Steps issue={i} />
                      {d && (
                        <button className="mt-3 text-sm font-semibold text-accent underline underline-offset-4" onClick={() => onPick(d.ip)}>
                          Show this device
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DeviceCard({ d, isNew, onClose }: { d: DeviceReport; isNew: boolean; onClose: () => void }) {
  const places = usePlaces();
  const saved = places[keyOf(d)];
  const room = roomFor(d, saved);
  return (
    <div>
      <button className="text-sm font-semibold text-muted hover:text-ink" onClick={onClose}>
        ← Back to the list
      </button>
      <div className="mt-3 flex items-start gap-3">
        <svg viewBox="0 0 24 24" className="h-11 w-11 shrink-0 rounded-full border-2 p-2" style={{ borderColor: toneOf(d.worst) }} aria-hidden>
          <path d={ICON[d.kind]} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="min-w-0">
          <h2 className="hand text-2xl leading-tight">{displayName(d, saved)}</h2>
          <p className="text-sm text-muted">
            {KIND_NAME[d.kind]}
            {d.confidence !== "sure" ? ` (${d.confidence === "likely" ? "probably" : "a guess"})` : ""}
            {isNew && <span className="ml-2 rounded-full border border-accent px-2 py-px text-xs font-bold text-accent">New since last scan</span>}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold">
          Call it
          <input className="field mt-1 py-1.5 text-[15px] font-normal" defaultValue={saved?.name ?? ""} placeholder={displayName(d)} onBlur={(e) => place(keyOf(d), { name: e.target.value.trim() || undefined })} />
        </label>
        <label className="text-sm font-semibold">
          Room
          <select className="field mt-1 py-1.5 text-[15px] font-normal" value={room ?? "doorstep"} onChange={(e) => place(keyOf(d), { room: e.target.value })}>
            {ROOMS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="doorstep">Not sure yet (doorstep)</option>
          </select>
        </label>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-faint">Address</dt>
        <dd className="font-mono">{d.ip}</dd>
        <dt className="text-faint">Hardware ID</dt>
        <dd className="font-mono">{d.mac ?? "unknown"}</dd>
        <dt className="text-faint">Made by</dt>
        <dd>{d.vendor ?? (d.mac && /^[0-9A-F][26AE]/i.test(d.mac) ? "Hidden (private address)" : "Unknown")}</dd>
        {d.os && (
          <>
            <dt className="text-faint">Software</dt>
            <dd>{d.os}</dd>
          </>
        )}
      </dl>
      <p className="mt-3 text-sm text-muted">
        <span className="font-semibold text-ink">Why we think it's a {KIND_NAME[d.kind].toLowerCase()}: </span>
        {d.reasons.join(" ")}
      </p>

      <h3 className="mt-5 text-[13px] font-bold text-faint">What it answers on the network</h3>
      {d.ports.length ? (
        <ul className="mt-1.5 space-y-1 text-sm">
          {d.ports.map((p) => (
            <li key={`${p.proto}${p.port}`} className="flex gap-3">
              <span className="w-16 shrink-0 font-mono text-faint">
                {p.port}
                {p.proto === "udp" ? "/udp" : ""}
              </span>
              <span>
                {serviceName(p)}
                {(p.product || p.banner) && <span className="text-faint"> ({[p.product, p.version].filter(Boolean).join(" ") || p.banner})</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-sm text-muted">Nothing. It doesn't accept connections from other devices, which is good.</p>
      )}

      <h3 className="mt-5 text-[13px] font-bold text-faint">{d.issues.length ? "What to do" : "Nothing to do"}</h3>
      <ul className="mt-2 space-y-4">
        {d.issues.map((i) => (
          <li key={i.id + i.port} className="flex gap-3">
            <Pip s={i.severity} />
            <div>
              <div className="font-semibold">
                {i.title} <span className="text-sm font-normal text-faint">({WHEN[i.severity].toLowerCase()})</span>
              </div>
              <div className="mt-1">
                <Steps issue={i} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function House() {
  const { report, changes, isNew, now, before } = useHome();
  const [params, setParams] = useSearchParams();
  const selected = params.get("device") ?? undefined;
  const d = report.devices.find((x) => x.ip === selected);
  const pick = (ip?: string) => {
    setParams(ip ? { device: ip } : {}, { replace: false });
    // On narrow screens the details sit below the plan, so bring them into view.
    if (ip && window.matchMedia("(max-width: 1279px)").matches) requestAnimationFrame(() => document.getElementById("details")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const urgent = report.issues.filter((i) => SEVERITY_RANK[i.severity] >= 3).length;
  const joined = changes.filter((c) => c.type === "joined").length;

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="min-w-0">
        <h1 className="text-[clamp(1.8rem,3.4vw,2.6rem)] font-bold leading-[1.1] tracking-[-0.015em]">
          {report.devices.length} devices are home.{" "}
          <span className="text-muted">
            {urgent ? `${urgent} need${urgent === 1 ? "s" : ""} you tonight.` : "None needs you tonight."}
            {joined ? ` ${joined} ${joined === 1 ? "is" : "are"} new.` : ""}
          </span>
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          From <span className="font-semibold text-ink">{now.name}</span>, scanned {new Date(now.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
          {before ? `, compared with ${before.name.toLowerCase()}` : ""}. <Link to="/scans" className="font-semibold text-accent underline underline-offset-4">Scan your own home</Link>
        </p>
        <div className="vellum card mt-5 overflow-x-auto p-3 sm:p-5">
          <div className="min-w-[720px]">
          <FloorPlan devices={report.devices} selected={selected} onSelect={(ip) => pick(ip)} isNew={isNew} />
          </div>
        </div>
        <p className="mt-2 text-sm text-faint">Drag a device to the room it's really in, or tap it to see what it is. Rings mark devices that are new since the last scan.</p>
      </section>
      <aside id="details" className="scroll-mt-4 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1">{d ? <DeviceCard key={d.ip} d={d} isNew={isNew(d)} onClose={() => pick()} /> : <Tonight issues={report.issues} devices={report.devices} onPick={pick} />}</aside>
    </div>
  );
}
