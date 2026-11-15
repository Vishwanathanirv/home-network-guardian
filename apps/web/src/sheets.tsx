import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { analyse, DEMO_XML_TONIGHT, KIND_NAME, parseAny, serviceName, SEVERITY_RANK, type Change, type DeviceReport, type Issue, type Severity } from "@lamplight/core";
import { addScan, displayName, issueKey, keyOf, place, removeScan, roomFor, ROOMS, setActive, toggleDone, useActive, useDone, useHome, usePlaces, useScans } from "./lib";
import { ICON, toneOf } from "./plan";

export const WHEN: Record<Severity, string> = { critical: "Tonight", high: "Tonight", medium: "This week", low: "When you have a minute", info: "For your information" };

/* ───────────── Small parts */

export function Glyph({ d, tone, size = 40 }: { d: DeviceReport; tone?: string; size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full border-2 bg-panel" style={{ width: size, height: size, borderColor: tone ?? toneOf(d.worst), boxShadow: `0 0 calc(var(--glow, 0) * 10px) ${tone ?? toneOf(d.worst)}` }} aria-hidden>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%]">
        <path d={ICON[d.kind]} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Check({ on, label, onClick, tone }: { on: boolean; label: string; onClick: () => void; tone: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={on ? "Mark as not done" : "Mark as done"}
      className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 transition-colors"
      style={{ borderColor: on ? "var(--ok)" : tone, background: on ? "var(--ok)" : "transparent" }}
    >
      {on && (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="var(--panel)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

function Steps({ issue }: { issue: Issue }) {
  return (
    <div className="text-[14.5px] leading-relaxed">
      <p className="text-muted">{issue.why}</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        {issue.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );
}

/** The header of a sheet you opened from somewhere: a title and a way back. */
export function SubHeader({ title, onClose, children }: { title: ReactNode; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <h1 className="text-[1.45rem] font-bold leading-tight tracking-[-0.01em]">{title}</h1>
        {children}
      </div>
      <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[color-mix(in_oklab,var(--ink)_9%,transparent)] text-muted hover:text-ink" aria-label="Close">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

const Section = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="mt-5">
    <div className="flex items-baseline justify-between">
      <h2 className="text-[13px] font-bold text-faint">{title}</h2>
      {aside}
    </div>
    <div className="mt-2">{children}</div>
  </section>
);

/* ───────────── Home: the summary and tonight's to-do list */

export function HomeSheet({ onPick, compact }: { onPick: (ip: string) => void; compact?: boolean }) {
  const { report, changes, isNew, now, before } = useHome();
  const places = usePlaces();
  const done = useDone();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);
  const devOf = (i: Issue) => report.devices.find((x) => x.ip === i.ip);
  const keyFor = (i: Issue) => {
    const d = devOf(i);
    return issueKey(d ? keyOf(d) : undefined, i);
  };
  const todo = report.issues.filter((i) => i.severity !== "info");
  const left = todo.filter((i) => !done[keyFor(i)]);
  const finished = todo.filter((i) => done[keyFor(i)]);
  const urgent = left.filter((i) => SEVERITY_RANK[i.severity] >= 3).length;
  const joined = changes.filter((c) => c.type === "joined").length;
  const groups = (["Tonight", "This week", "When you have a minute"] as const).map((g) => [g, left.filter((i) => WHEN[i.severity] === g)] as const).filter(([, l]) => l.length);

  const row = (i: Issue, n: number) => {
    const d = devOf(i);
    const k = keyFor(i);
    const id = `${k}-${n}`;
    const isOpen = open === id;
    const isDone = !!done[k];
    return (
      <li key={id} className="rise">
        <div className="flex gap-3 py-2.5">
          <Check on={isDone} tone={toneOf(i.severity)} onClick={() => toggleDone(k)} label={`${isDone ? "Not done" : "Done"}: ${i.title}`} />
          <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : id)} aria-expanded={isOpen}>
            <span className={`block font-semibold leading-snug ${isDone ? "text-faint line-through" : ""}`}>{i.title}</span>
            <span className="block text-[13.5px] text-muted">{d ? displayName(d, places[keyOf(d)]) : "Your whole network"}</span>
          </button>
        </div>
        {isOpen && (
          <div className="mb-2 ml-9 rounded-xl bg-[color-mix(in_oklab,var(--ink)_5%,transparent)] p-3">
            <Steps issue={i} />
            {d && (
              <button className="mt-2.5 text-[14px] font-semibold text-accent" onClick={() => onPick(d.ip)}>
                Show it on the plan
              </button>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <div>
      <h1 className="text-[1.45rem] font-bold leading-[1.2] tracking-[-0.01em]">
        {report.devices.length} devices are home.{" "}
        <span className="text-muted">
          {urgent ? `${urgent} need${urgent === 1 ? "s" : ""} you tonight.` : "None needs you tonight."}
          {joined ? ` ${joined} ${joined === 1 ? "is" : "are"} new.` : ""}
        </span>
      </h1>
      <p className="mt-1 text-[13.5px] text-muted">
        {now.name}, {new Date(now.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </p>

      {/* Shortcuts, like the favourites row of a maps app. */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          { to: "/changes", t: "What changed", n: before ? changes.length : 0, d: "M12 8v4l3 2M12 3a9 9 0 1 0 9 9" },
          { to: "/scans", t: "Scan your home", d: "M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M4 12h16" },
          { to: "/how", t: "How it works", d: "M12 17h.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
        ].map((s) => (
          <button key={s.to} onClick={() => navigate(s.to)} className="relative flex flex-col items-center gap-1.5 rounded-xl px-1 py-2.5 text-[12.5px] font-semibold hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-panel">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path d={s.d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {s.t}
            {!!s.n && <span className="absolute right-[22%] top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-risk px-1 text-[11px] font-bold text-panel">{s.n}</span>}
          </button>
        ))}
      </div>

      {!compact && (
        <>
          {todo.length > 0 && (
            <div className="mt-4">
              <div className="flex justify-between text-[13px] font-semibold text-muted">
                <span>
                  {finished.length} of {todo.length} fixed
                </span>
                {left.length === 0 && <span className="text-ok">All done</span>}
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--ink)_10%,transparent)]">
                <div className="h-full rounded-full bg-ok transition-[width] duration-500" style={{ width: `${(finished.length / todo.length) * 100}%` }} />
              </div>
            </div>
          )}
          {groups.map(([g, list]) => (
            <Section key={g} title={g}>
              <ul className="divide-y divide-line">{list.map(row)}</ul>
            </Section>
          ))}
          {!groups.length && <p className="mt-5 text-muted">Nothing left to fix. Every device looks fine.</p>}
          {finished.length > 0 && (
            <Section
              title={`Done (${finished.length})`}
              aside={
                <button className="text-[13px] font-semibold text-accent" onClick={() => setShowDone(!showDone)}>
                  {showDone ? "Hide" : "Show"}
                </button>
              }
            >
              {showDone && <ul className="divide-y divide-line">{finished.map(row)}</ul>}
            </Section>
          )}
          {isNew && joined > 0 && (
            <Section title="New since the last scan">
              <ul className="space-y-1">
                {report.devices.filter(isNew).map((d) => (
                  <li key={d.ip}>
                    <DeviceRow d={d} onPick={onPick} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <p className="mt-6 text-[12.5px] leading-relaxed text-faint">
            Built by{" "}
            <a href="https://vishwanathan.dev" className="underline underline-offset-2">
              Vishwanathan R
            </a>
            . The example home is made up; your scans stay in your browser. Vendor names from the IEEE OUI registry.{" "}
            <a href="https://github.com/Vishwanathanirv/home-network-guardian" className="underline underline-offset-2">
              Source
            </a>
          </p>
        </>
      )}
    </div>
  );
}

/* ───────────── A row in any list of devices */

export function DeviceRow({ d, onPick, left }: { d: DeviceReport; onPick: (ip: string) => void; left?: number }) {
  const places = usePlaces();
  const saved = places[keyOf(d)];
  const room = ROOMS.find((r) => r.id === roomFor(d, saved));
  const n = left ?? d.issues.filter((i) => i.severity !== "info").length;
  return (
    <button onClick={() => onPick(d.ip)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]">
      <Glyph d={d} size={38} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{displayName(d, saved)}</span>
        <span className="block truncate text-[13px] text-muted">
          {KIND_NAME[d.kind]}, {room ? room.name.toLowerCase() : "on the doorstep"}
        </span>
      </span>
      {n > 0 && (
        <span className="rounded-full px-2 py-0.5 text-[12px] font-bold" style={{ color: toneOf(d.worst), background: `color-mix(in oklab, ${toneOf(d.worst)} 14%, transparent)` }}>
          {n} to fix
        </span>
      )}
    </button>
  );
}

/* ───────────── One device */

export function DeviceSheet({ d, isNew, onClose }: { d: DeviceReport; isNew: boolean; onClose: () => void }) {
  const places = usePlaces();
  const done = useDone();
  const saved = places[keyOf(d)];
  const room = roomFor(d, saved);
  const [why, setWhy] = useState(false);
  const issues = d.issues.filter((i) => i.severity !== "info");
  const info = d.issues.filter((i) => i.severity === "info");
  return (
    <div>
      <div className="flex items-start gap-3">
        <Glyph d={d} size={48} />
        <div className="min-w-0 flex-1">
          <SubHeader title={displayName(d, saved)} onClose={onClose}>
            <p className="text-[13.5px] text-muted">
              {KIND_NAME[d.kind]}
              {d.confidence !== "sure" ? ` (${d.confidence === "likely" ? "probably" : "a guess"})` : ""}
              {isNew && <span className="ml-2 rounded-full bg-accent px-2 py-px text-[11.5px] font-bold text-panel">New</span>}
            </p>
          </SubHeader>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <label className="text-[13px] font-semibold text-muted">
          Call it
          <input className="field mt-1 py-1.5 text-[15px] font-normal text-ink" defaultValue={saved?.name ?? ""} placeholder={displayName(d)} onBlur={(e) => place(keyOf(d), { name: e.target.value.trim() || undefined })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
        </label>
        <label className="text-[13px] font-semibold text-muted">
          Room
          <select className="field mt-1 py-1.5 text-[15px] font-normal text-ink" value={room ?? "doorstep"} onChange={(e) => place(keyOf(d), { room: e.target.value })}>
            {ROOMS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="doorstep">Not sure yet (doorstep)</option>
          </select>
        </label>
      </div>

      <Section title={issues.length ? `What to do (${issues.filter((i) => !done[issueKey(keyOf(d), i)]).length} left)` : "Nothing to do"}>
        {issues.length ? (
          <ul className="space-y-3">
            {issues.map((i) => {
              const k = issueKey(keyOf(d), i);
              const on = !!done[k];
              return (
                <li key={i.id + i.port} className="flex gap-3">
                  <Check on={on} tone={toneOf(i.severity)} onClick={() => toggleDone(k)} label={`${on ? "Not done" : "Done"}: ${i.title}`} />
                  <div className="min-w-0">
                    <div className={`font-semibold leading-snug ${on ? "text-faint line-through" : ""}`}>
                      {i.title} <span className="text-[13px] font-normal text-faint">({WHEN[i.severity].toLowerCase()})</span>
                    </div>
                    {!on && (
                      <div className="mt-1">
                        <Steps issue={i} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[14.5px] text-muted">It looks fine. Nothing it answers on is risky for a {KIND_NAME[d.kind].toLowerCase()}.</p>
        )}
        {info.map((i) => (
          <p key={i.id} className="mt-3 text-[14px] text-muted">
            <span className="font-semibold text-ink">{i.title}.</span> {i.why}
          </p>
        ))}
      </Section>

      <Section title="What it answers on the network">
        {d.ports.length ? (
          <ul className="space-y-1 text-[14px]">
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
          <p className="text-[14px] text-muted">Nothing. It doesn't accept connections from other devices, which is good.</p>
        )}
      </Section>

      <Section title="Details">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
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
        <button className="mt-2 text-[13.5px] font-semibold text-accent" onClick={() => setWhy(!why)} aria-expanded={why}>
          Why we think it's a {KIND_NAME[d.kind].toLowerCase()}
        </button>
        {why && <p className="mt-1 text-[14px] text-muted">{d.reasons.join(" ")}</p>}
      </Section>
    </div>
  );
}

/* ───────────── What changed */

const TEXT: Record<Change["type"], string> = { joined: "Joined the network", left: "Not seen this time", moved: "Got a new address", opened: "Started answering on", closed: "Stopped answering on" };

export function ChangesSheet({ onClose, onPick }: { onClose: () => void; onPick: (ip: string) => void }) {
  const { report, changes, now, before } = useHome();
  const places = usePlaces();
  if (!before)
    return (
      <div>
        <SubHeader title="What changed" onClose={onClose} />
        <p className="mt-3 text-muted">
          Mark an earlier scan as "before" in{" "}
          <Link to="/scans" className="font-semibold text-accent">
            your scans
          </Link>{" "}
          to see what changed since then.
        </p>
      </div>
    );
  const order: Change["type"][] = ["joined", "opened", "moved", "closed", "left"];
  const sorted = [...changes].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return (
    <div>
      <SubHeader title="What changed" onClose={onClose}>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">
          Since {before.name.toLowerCase()} ({new Date(before.scan.at).toLocaleDateString()}). A new device you don't recognise matters most: it may be a neighbour on your Wi-Fi.
        </p>
      </SubHeader>
      {sorted.length ? (
        <ol className="mt-4 border-l-2 border-line pl-5">
          {sorted.map((c, i) => {
            const d = report.devices.find((x) => keyOf(x) === keyOf(c.device));
            const name = d ? displayName(d, places[keyOf(d)]) : (c.device.hostname ?? c.device.ip);
            const tone = c.type === "joined" || c.type === "opened" ? "var(--warn)" : "var(--faint)";
            return (
              <li key={i} className="relative pb-4">
                <span className="absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full border-2 bg-panel" style={{ borderColor: tone }} aria-hidden />
                <div className="text-[13px] font-bold" style={{ color: tone }}>
                  {TEXT[c.type]}
                  {(c.type === "opened" || c.type === "closed") && ` ${c.ports.map((p) => serviceName(c.device.ports.find((x) => x.port === p) ?? { port: p, proto: "tcp" })).join(", ")}`}
                </div>
                <div className="font-semibold">
                  {d ? (
                    <a href={`/?device=${d.ip}`} onClick={(e) => (e.preventDefault(), onPick(d.ip))} className="hover:underline">
                      {name}
                    </a>
                  ) : (
                    name
                  )}
                </div>
                <div className="font-mono text-[12.5px] text-faint">
                  {c.device.ip}
                  {c.type === "moved" ? ` (was ${c.from})` : ""}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 text-muted">Nothing changed: the same devices, answering on the same services.</p>
      )}
      <Section title="Get told when a new device joins">
        <p className="text-[14px] text-muted">Run the scanner every night (a Raspberry Pi works well). It exits with code 1 when a device joins, so cron can mail you the output.</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] p-2.5 font-mono text-[12px] leading-relaxed">{`0 2 * * * cd ~/lamplight && node lamplight.cjs scan --out today.json >/dev/null && node lamplight.cjs compare last.json today.json; mv today.json last.json`}</pre>
      </Section>
      <p className="mt-3 text-[12.5px] text-faint">Compared with {now.name.toLowerCase()}.</p>
    </div>
  );
}

/* ───────────── Scans */

export function ScansSheet({ onClose }: { onClose: () => void }) {
  const scans = useScans();
  const active = useActive();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [how, setHow] = useState<number | null>(0);
  const load = (name: string, body: string) => {
    try {
      const scan = parseAny(body);
      if (!scan.devices.length) throw new Error("The scan has no devices in it.");
      addScan(name, scan);
      setError(null);
      setText("");
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const WAYS = [
    { t: "Easiest: the Lamplight scanner", code: "node lamplight.cjs scan", body: "Download scanner/lamplight.cjs from the project on GitHub and run it with Node 20 or newer. It finds your network by itself, takes about a minute, and saves a file you open here." },
    { t: "If you use nmap", code: "sudo nmap -sV -O -oX scan.xml 192.168.1.0/24", body: "Change the address to your network. With sudo, nmap can read hardware IDs and guess each device's system." },
    { t: "Quickest: your ARP table", code: "arp -a", body: "Lists the devices your computer has talked to recently, without their services. Works on Windows, Mac and Linux. Paste the output below." },
  ];
  return (
    <div>
      <SubHeader title="Scan your home" onClose={onClose}>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">A website can't see your home network, so the scan runs on a computer in your house. Open the result here: it's read in your browser and nothing is uploaded.</p>
      </SubHeader>
      <ul className="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line">
        {WAYS.map((w, i) => (
          <li key={w.t}>
            <button className="flex w-full items-center justify-between px-3 py-2.5 text-left font-semibold" onClick={() => setHow(how === i ? null : i)} aria-expanded={how === i}>
              {w.t}
              <span className="text-faint">{how === i ? "−" : "+"}</span>
            </button>
            {how === i && (
              <div className="px-3 pb-3 text-[14px] text-muted">
                {w.body}
                <pre className="mt-2 overflow-x-auto rounded-lg bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] p-2.5 font-mono text-[12.5px] text-ink">{w.code}</pre>
              </div>
            )}
          </li>
        ))}
      </ul>

      <Section title="Open a scan">
        <textarea className="field h-28 font-mono text-[12.5px]" spellCheck={false} placeholder="Paste scan JSON, nmap XML or the output of arp -a" value={text} onChange={(e) => setText(e.target.value)} aria-label="Scan contents" />
        {error && (
          <p className="mt-1.5 text-[14px] font-semibold text-risk" role="alert">
            {error}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn primary" disabled={!text.trim()} onClick={() => load(`Pasted ${new Date().toLocaleDateString()}`, text)}>
            Show it on the plan
          </button>
          <label className="btn cursor-pointer">
            Choose a file
            <input
              type="file"
              className="sr-only"
              accept=".json,.xml,.txt"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) load(f.name.replace(/\.(json|xml|txt)$/i, ""), await f.text());
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <a className="mt-2 inline-block text-[13.5px] font-semibold text-accent" href={`data:application/xml;charset=utf-8,${encodeURIComponent(DEMO_XML_TONIGHT)}`} download="example-scan.xml">
          Download an example nmap file
        </a>
      </Section>

      <Section title="Your scans">
        <p className="-mt-1 mb-2 text-[13px] text-muted">The plan shows the scan marked "now" and compares it with "before" to spot new devices.</p>
        <ul className="divide-y divide-line">
          {scans.map((s) => {
            const r = analyse(s.scan);
            return (
              <li key={s.id} className="py-2.5">
                <div className="font-semibold">{s.name}</div>
                <div className="text-[13px] text-muted">
                  {new Date(s.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}, {s.scan.devices.length} devices, {r.issues.filter((i) => i.severity !== "info").length} to fix
                </div>
                <div className="mt-1.5 flex gap-1 text-[13px]" role="group" aria-label={`Use ${s.name} as`}>
                  <button className={`rounded-full px-3 py-1 font-semibold ${active.now === s.id ? "bg-ink text-bg" : "bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] text-muted hover:text-ink"}`} onClick={() => setActive({ now: s.id, before: active.before === s.id ? null : active.before })} aria-pressed={active.now === s.id}>
                    Now
                  </button>
                  <button className={`rounded-full px-3 py-1 font-semibold ${active.before === s.id ? "bg-ink text-bg" : "bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] text-muted hover:text-ink"}`} onClick={() => setActive({ now: active.now === s.id ? (active.before ?? s.id) : active.now, before: active.before === s.id ? null : s.id })} aria-pressed={active.before === s.id}>
                    Before
                  </button>
                  {!s.demo && (
                    <button className="rounded-full px-3 py-1 text-muted hover:text-risk" onClick={() => removeScan(s.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

/* ───────────── How it works */

export function HowSheet({ onClose }: { onClose: () => void }) {
  const parts = [
    ["Finding devices", "The scanner tries to connect to 39 well-known ports on every address in your network. A device that answers, or even refuses, is there. Your computer then knows its hardware ID (MAC address) from the ARP table. It also asks UPnP devices to announce themselves. It only scans private addresses and never tries to log in to anything."],
    ["Working out what each one is", "The first half of a MAC address belongs to the maker, so Lamplight looks it up in the IEEE's public registry (about 40,000 entries). It adds the device's own name, the services it answers on (554 means a video stream, 9100 a printer, 62078 an iPhone) and the scanner's guess at its software. Each clue adds weight to a type, and the device's page says which clues were used and how sure it is."],
    ["Deciding what matters", "The checks are written for homes. Telnet on a camera and Android debugging on a TV box are urgent, because botnets take over exactly those. File sharing is normal on a NAS and odd on a light bulb. UPnP on the router, an unencrypted camera stream and a settings page without HTTPS are worth fixing this week. A short list of software versions with notorious holes is checked too."],
  ];
  return (
    <div>
      <SubHeader title="How Lamplight works" onClose={onClose}>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">It answers three questions: what's on my network, which devices are risky, and what exactly do I do about it.</p>
      </SubHeader>
      <ol className="mt-4 space-y-4">
        {parts.map(([t, b], i) => (
          <li key={t} className="flex gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-[13px] font-bold text-panel">{i + 1}</span>
            <div>
              <h2 className="font-bold">{t}</h2>
              <p className="mt-0.5 text-[14.5px] leading-relaxed text-muted">{b}</p>
            </div>
          </li>
        ))}
      </ol>
      <Section title="What it can't tell you">
        <ul className="list-disc space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-muted">
          <li>Whether a password is weak. Lamplight never logs in to your devices.</li>
          <li>Anything about devices that don't answer. Phones usually ignore connections, which is good.</li>
          <li>Every known vulnerability. Version checks are few and certain on purpose.</li>
          <li>What your router exposes to the internet. That needs a scan from outside your home.</li>
        </ul>
      </Section>
      <Section title="Privacy">
        <p className="text-[14.5px] leading-relaxed text-muted">Scans, names and rooms are saved in your browser's storage. Nothing is sent anywhere.</p>
      </Section>
    </div>
  );
}
