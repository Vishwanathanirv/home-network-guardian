import { useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { KIND_NAME, serviceName, SEVERITY_RANK, type Change, type DeviceReport, type Issue, type Severity } from "@lamplight/core";
import { displayName, issueKey, keyOf, roomFor, ROOMS, toggleDone, useDone, useHome, usePlaces } from "./lib";
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

export function Check({ on, label, onClick, tone }: { on: boolean; label: string; onClick: () => void; tone: string }) {
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

export function Steps({ issue }: { issue: Issue }) {
  return (
    <div className="text-[14.5px] leading-relaxed">
      <p className="text-muted">{issue.why}</p>
      {issue.basis && (
        <span className="mt-1.5 mr-1.5 inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-[12px] font-semibold" style={{ color: issue.basis === "checked" ? "var(--risk)" : "var(--muted)" }}>
          {issue.basis === "checked" ? "Checked: we confirmed this" : "Possible: based on its version number"}
        </span>
      )}
      {issue.cve && (
        <a href={`https://nvd.nist.gov/vuln/detail/${issue.cve}`} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-0.5 font-mono text-[12px] font-semibold hover:border-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-risk" />
          {issue.cve}
          <span className="text-faint">↗</span>
        </a>
      )}
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

export const Section = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
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
        {report.devices.length === 1 ? "1 device is home." : `${report.devices.length} devices are home.`}{" "}
        <span className="text-muted">
          {urgent ? `${urgent} need${urgent === 1 ? "s" : ""} you tonight.` : "None needs you tonight."}
          {joined ? ` ${joined} ${joined === 1 ? "is" : "are"} new.` : ""}
        </span>
      </h1>
      <p className="mt-1 text-[13.5px] text-muted">
        {now.name}, {new Date(now.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      </p>

      {/* Shortcuts, like the favourites row of a maps app. */}
      <div className="mt-4 grid grid-cols-4 gap-1">
        {[
          { to: "/network", t: "Network", d: "M12 3v4M5 21v-4h14v4M12 13V7M5 17v-4h14v4M9 3h6v4H9z" },
          { to: "/changes", t: "What changed", n: before ? changes.length : 0, d: "M12 8v4l3 2M12 3a9 9 0 1 0 9 9" },
          { to: "/scans", t: "Scan your home", d: "M4 17l6-6-6-6M12 19h8" },
          { to: "/how", t: "How it works", d: "M12 17h.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" },
        ].map((s) => (
          <button key={s.to} onClick={() => navigate(s.to)} className="relative flex flex-col items-center gap-1.5 rounded-xl px-0.5 py-2.5 text-center text-[12px] font-semibold leading-tight hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-accent text-panel">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
                <path d={s.d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            {s.t}
            {!!s.n && <span className="absolute right-[14%] top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-risk px-1 text-[11px] font-bold text-panel">{s.n}</span>}
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
              {/* One lamp per fix: it lights up when you tick the problem off. Most urgent first. */}
              <div
                className="lamps mt-2"
                role="progressbar"
                aria-label="Problems fixed"
                aria-valuemin={0}
                aria-valuemax={todo.length}
                aria-valuenow={finished.length}
                aria-valuetext={`${finished.length} of ${todo.length} fixed`}
              >
                {[...todo]
                  .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
                  .map((i) => (
                    <span key={keyFor(i)} className={`lamp${done[keyFor(i)] ? " lit" : ""}`} style={{ "--tone": toneOf(i.severity) } as CSSProperties} />
                  ))}
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
            {now.demo ? "The example home is made up. " : ""}Your scans stay on your computer. Vendor names from the IEEE OUI registry.
          </p>
        </>
      )}
    </div>
  );
}

/* ───────────── A row in any list of devices */

export function DeviceRow({ d, onPick, left, note }: { d: DeviceReport; onPick: (ip: string) => void; left?: number; note?: string }) {
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
          {note ? `, ${note}` : ""}
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

/* ───────────── How it works */

export function HowSheet({ onClose, onPick }: { onClose: () => void; onPick: (ip: string) => void }) {
  const parts = [
    ["Finding devices", "The scanner knocks once on every address in your network, then reads your computer's ARP table, which lists even silent phones. Only the devices it found get the full check of 39 well-known services, so a scan takes seconds. It asks each one its name six ways (Bonjour, NetBIOS, LLMNR, UPnP, the router and your computer's own lookup), and checks how your Wi-Fi is locked. It only scans private addresses, gently, and runs entirely on your computer."],
    ["Working out what each one is", "The first half of a MAC address belongs to the maker, so Lamplight looks it up in the IEEE's public registry (about 40,000 entries). It adds the device's own name, the services it answers on (554 means a video stream, 9100 a printer, 62078 an iPhone) and the scanner's guess at its software. Each clue adds weight to a type, and the device's page says which clues were used and how sure it is."],
    ["Deciding what matters", "The checks are written for homes. Telnet on a camera and Android debugging on a TV box are urgent, because botnets take over exactly those. File sharing is normal on a NAS and odd on a light bulb. UPnP on the router, an unencrypted camera stream and a settings page without HTTPS are worth fixing this week. A short list of software versions with notorious holes is checked too, marked \"possible\" because makers sometimes fix a flaw without changing the version number."],
    ["Proving the worst ones", "Where it can, Lamplight checks instead of guessing, without ever using a password: does a camera hand over its video stream with no password, does an FTP server let in the public guest account, does a device still speak SMBv1, the protocol WannaCry spread through. These read nothing and change nothing."],
  ];
  const { report } = useHome();
  const places = usePlaces();
  // The devices worth following: the riskiest first, so the first pick is the one you'd most want explained.
  const rank = (x: DeviceReport) => (x.worst ? SEVERITY_RANK[x.worst] : -1);
  const ranked = [...report.devices].sort((a, b) => rank(b) - rank(a) || b.ports.length - a.ports.length).slice(0, 8);
  const [ip, setIp] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const d = ranked.find((x) => x.ip === ip) ?? ranked[0];
  const probes = d?.details?.probes;
  const proven = d ? d.issues.filter((i) => i.basis === "checked").length : 0;
  const names = d ? [d.hostname && `network name "${d.hostname}"`, d.details?.name && `its own name "${d.details.name}"`, d.details?.netbios && `Windows name "${d.details.netbios.name}"`, d.details?.model && `model "${d.details.model}"`].filter(Boolean) : [];
  const tone: Record<Severity, string> = { critical: "var(--risk)", high: "var(--risk)", medium: "var(--warn)", low: "var(--accent)", info: "var(--faint)" };
  const hasProbe = !!probes && (probes.rtsp !== undefined || probes.ftpAnon !== undefined || probes.smb1 !== undefined);

  return (
    <div>
      <SubHeader title="How Lamplight works" onClose={onClose}>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">It answers three questions: what's on my network, which devices are risky, and what exactly do I do about it. Follow one device from this scan through all four steps.</p>
      </SubHeader>

      {d && (
        <>
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]" role="radiogroup" aria-label="Device to follow">
            {ranked.map((x) => (
              <button key={x.ip} role="radio" aria-checked={x.ip === d.ip} onClick={() => setIp(x.ip)} className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold ${x.ip === d.ip ? "border-accent text-ink" : "border-line text-muted hover:text-ink"}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: x.worst ? tone[x.worst] : "var(--ok)" }} aria-hidden />
                {displayName(x, places[keyOf(x)])}
              </button>
            ))}
          </div>

          <ol className="mt-3 grid grid-cols-4 gap-1" aria-label="Steps">
            {parts.map(([t], i) => (
              <li key={t}>
                <button onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className={`h-full w-full rounded-xl border px-2 py-1.5 text-left text-[12px] font-semibold leading-tight ${step === i ? "border-accent bg-[color-mix(in_oklab,var(--accent)_12%,transparent)]" : "border-line text-muted hover:text-ink"}`}>
                  <span className="block text-[11px] text-faint">{i + 1}</span>
                  {t}
                </button>
              </li>
            ))}
          </ol>

          <section className="mt-3 rounded-2xl border border-line p-3.5" aria-live="polite">
            <h2 className="font-bold">
              {step + 1}. {parts[step][0]}
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{parts[step][1]}</p>
            <div className="mt-3 border-t border-line pt-3 text-[13.5px]">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-faint">For {displayName(d, places[keyOf(d)])}</p>
              {step === 0 && (
                <ul className="mt-1.5 space-y-1">
                  <li>
                    Found at <span className="font-mono">{d.ip}</span>
                    {d.mac && (
                      <>
                        , network card <span className="font-mono">{d.mac}</span>
                      </>
                    )}
                  </li>
                  <li>{d.ports.length ? `Answers on ${d.ports.length} service${d.ports.length === 1 ? "" : "s"}: ${d.ports.slice(0, 6).map((p) => `${serviceName(p)} (${p.port})`).join(", ")}${d.ports.length > 6 ? "…" : ""}` : "Answers on no services: quiet, which is good."}</li>
                  {names.length > 0 && <li>Calls itself {names.join(", ")}</li>}
                </ul>
              )}
              {step === 1 && (
                <ul className="mt-1.5 space-y-1">
                  <li>
                    {KIND_NAME[d.kind]}, <span className="text-muted">{d.confidence === "guess" ? "a guess" : d.confidence}</span>
                    {d.vendor && <> · made by {d.vendor}</>}
                  </li>
                  {d.reasons.slice(0, 5).map((r) => (
                    <li key={r} className="text-muted">
                      · {r}
                    </li>
                  ))}
                </ul>
              )}
              {step === 2 &&
                (d.issues.length ? (
                  <ul className="mt-1.5 space-y-1.5">
                    {[...d.issues]
                      .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
                      .slice(0, 6)
                      .map((i) => (
                        <li key={i.id + (i.port ?? "")} className="flex gap-2">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: tone[i.severity] }} aria-hidden />
                          <span>
                            <span className="font-semibold">{i.title}</span> <span className="text-muted">· {WHEN[i.severity].toLowerCase()}</span>
                            {i.basis === "version" && <span className="text-faint"> · possible, from the version it reports</span>}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-[var(--ok)]">Nothing to fix on this one.</p>
                ))}
              {step === 3 &&
                (hasProbe ? (
                  <ul className="mt-1.5 space-y-1">
                    {probes!.rtsp && <li>{probes!.rtsp.open ? "Its video stream answered without a password: proven open." : "Its video stream asked for a password: good."}</li>}
                    {probes!.ftpAnon !== undefined && <li>{probes!.ftpAnon ? "Its FTP server let the public guest account in: proven." : "Its FTP server turned the guest account away: good."}</li>}
                    {probes!.smb1 !== undefined && <li>{probes!.smb1 ? "It still speaks SMBv1: proven." : "It no longer speaks SMBv1: good."}</li>}
                    {proven > 0 && <li className="text-muted">{proven} of its problems are proven, not guessed.</li>}
                  </ul>
                ) : (
                  <p className="mt-1.5 text-muted">Nothing on this device needed proving: none of the read-only checks apply to the services it answers on.</p>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn" disabled={step === 0} onClick={() => setStep((n) => n - 1)}>
                ← Back
              </button>
              {step < parts.length - 1 ? (
                <button className="btn primary" onClick={() => setStep((n) => n + 1)}>
                  Next: {parts[step + 1][0]} →
                </button>
              ) : (
                <button className="btn primary" onClick={() => onPick(d.ip)}>
                  Open this device →
                </button>
              )}
            </div>
          </section>
        </>
      )}
      <Section title="What it can't tell you">
        <ul className="list-disc space-y-1.5 pl-5 text-[14.5px] leading-relaxed text-muted">
          <li>Whether a password is weak. Lamplight never uses or guesses passwords.</li>
          <li>Anything about devices that don't answer. Phones usually ignore connections, which is good.</li>
          <li>Every known vulnerability. Version checks are few on purpose, and only a hint: an update is the real answer.</li>
          <li>Every door your router opens to the internet. It reads the ones opened through UPnP; ones you set by hand need a scan from outside your home.</li>
          <li>What devices send to the internet, or devices on a separate guest network.</li>
        </ul>
      </Section>
      <Section title="Privacy">
        <p className="text-[14.5px] leading-relaxed text-muted">Scans, names and rooms are saved in your browser's storage. Nothing is sent anywhere.</p>
      </Section>
    </div>
  );
}
