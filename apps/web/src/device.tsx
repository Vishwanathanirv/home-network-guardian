import { useState, type ReactNode } from "react";
import { KIND_NAME, serviceName, type DeviceReport, type Issue } from "@lamplight/core";
import { displayName, gradeOf, issueKey, keyOf, place, roomFor, ROOMS, scoreOf, toggleDone, useDone, useHistory, usePlaces } from "./lib";
import { toneOf } from "./plan";
import { Check, Glyph, Section, Steps, SubHeader, WHEN } from "./sheets";

/** Bonjour service types in words. */
export const BONJOUR: Record<string, string> = {
  _googlecast: "Google Cast",
  _androidtvremote2: "Android TV remote",
  _androidtvremote: "Android TV remote",
  "_amzn-wplay": "Fire TV casting",
  _airplay: "AirPlay",
  _raop: "AirPlay audio",
  "_companion-link": "Apple device link",
  "_apple-mobdev2": "iPhone and iPad sync",
  _ipp: "Printing",
  _ipps: "Secure printing",
  _printer: "Printing (LPD)",
  "_pdl-datastream": "Printing (raw)",
  _uscan: "Scanning",
  _scanner: "Scanning",
  _hap: "HomeKit",
  _matter: "Matter",
  _sonos: "Sonos",
  "_spotify-connect": "Spotify Connect",
  _smb: "Windows file sharing",
  _afpovertcp: "Mac file sharing",
  _workstation: "Computer",
  _ssh: "Remote login (SSH)",
  "_sftp-ssh": "File transfer (SFTP)",
  _rfb: "Screen sharing",
  "_home-assistant": "Home Assistant",
  _http: "Web page",
  "_device-info": "Device info",
};
export const bonjourName = (s: string) => BONJOUR[s.split(".")[0]] ?? s.replace(/^_/, "").replace(/\._(tcp|udp)$/, "");

const TABS = ["Overview", "Fix", "Services", "History", "Raw"] as const;
type Tab = (typeof TABS)[number];

function Row({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-faint">{k}</dt>
      <dd className={`min-w-0 break-words ${mono ? "font-mono text-[13px]" : ""}`}>{children}</dd>
    </>
  );
}

/** A ring showing the safety score out of 100. */
export function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  const tone = score >= 90 ? "var(--ok)" : score >= 55 ? "var(--warn)" : "var(--risk)";
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Safety score ${score} out of 100, grade ${gradeOf(score)}`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={5} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} style={{ transition: "stroke-dashoffset .5s" }} />
      </svg>
      <span className="absolute text-center leading-none">
        <span className="block text-[17px] font-bold" style={{ color: tone }}>
          {gradeOf(score)}
        </span>
        <span className="block text-[10px] font-semibold text-faint">{score}</span>
      </span>
    </span>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      className="rounded-full bg-[color-mix(in_oklab,var(--ink)_9%,transparent)] px-3 py-1 text-[12.5px] font-semibold hover:text-accent"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setOk(true);
          setTimeout(() => setOk(false), 1300);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {ok ? "Copied" : label}
    </button>
  );
}

const CONFIDENCE = { sure: 3, likely: 2, guess: 1 } as const;

export function DeviceSheet({ d, isNew, onClose }: { d: DeviceReport; isNew: boolean; onClose: () => void }) {
  const places = usePlaces();
  const done = useDone();
  const history = useHistory(d);
  const saved = places[keyOf(d)];
  const room = roomFor(d, saved);
  const info = d.details ?? {};
  const issues = d.issues.filter((i) => i.severity !== "info");
  const notes = d.issues.filter((i) => i.severity === "info");
  const left = issues.filter((i) => !done[issueKey(keyOf(d), i)]);
  const score = scoreOf(left);
  const [tab, setTab] = useState<Tab>("Overview");
  const seen = history.filter((h) => h.device).length;
  const privateMac = !!d.mac && /^[0-9A-F][26AE]/i.test(d.mac);

  const issueRow = (i: Issue) => {
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
  };

  return (
    <div>
      <div className="flex items-start gap-3">
        <Glyph d={d} size={48} />
        <div className="min-w-0 flex-1">
          <SubHeader title={displayName(d, saved)} onClose={onClose}>
            <p className="text-[13.5px] text-muted">
              {KIND_NAME[d.kind]}
              {info.model ? `, ${info.model}` : ""}
              {isNew && <span className="ml-2 rounded-full bg-accent px-2 py-px text-[11.5px] font-bold text-panel">New</span>}
            </p>
          </SubHeader>
        </div>
      </div>

      {/* At a glance */}
      <div className="mt-4 flex items-center gap-4 rounded-2xl bg-panel-2 p-3">
        <ScoreRing score={score} />
        <dl className="grid flex-1 grid-cols-3 gap-2 text-center">
          {[
            [String(left.length), left.length === 1 ? "to fix" : "to fix"],
            [String(d.ports.length), d.ports.length === 1 ? "service" : "services"],
            [info.rtt !== undefined ? `${info.rtt} ms` : "–", "response"],
          ].map(([v, l]) => (
            <div key={l}>
              <dt className="sr-only">{l}</dt>
              <dd className="text-[17px] font-bold tabular-nums">{v}</dd>
              <dd className="text-[11.5px] font-semibold text-faint">{l}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="-mx-1 mt-4 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]" role="tablist" aria-label="Device details">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`shrink-0 rounded-full px-3 py-1.5 text-[13.5px] font-semibold ${tab === t ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {t === "Fix" ? `Fix${left.length ? ` (${left.length})` : ""}` : t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div role="tabpanel" aria-label="Overview">
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

          {left.length > 0 && (
            <Section title="Needs fixing">
              <ul className="space-y-1.5">
                {left.map((i) => (
                  <li key={i.id + i.port}>
                    <button className="flex w-full items-start gap-2.5 text-left" onClick={() => setTab("Fix")}>
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: toneOf(i.severity) }} aria-hidden />
                      <span className="font-semibold leading-snug hover:text-accent">{i.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Identity">
            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[14px]">
              {info.name && <Row k="Calls itself">{info.name}</Row>}
              {info.model && <Row k="Model">{info.model}</Row>}
              <Row k="Made by">{info.maker && d.vendor && !d.vendor.toLowerCase().includes(info.maker.toLowerCase().split(/[ ,]/)[0]) ? `${info.maker} (network chip by ${d.vendor})` : (info.maker ?? d.vendor ?? (privateMac ? "Hidden (private address)" : "Unknown"))}</Row>
              {d.os && <Row k="Software">{d.os}</Row>}
              {info.netbios && (
                <Row k="Windows name">
                  {info.netbios.name}
                  {info.netbios.group ? <span className="text-faint"> in {info.netbios.group}</span> : null}
                </Row>
              )}
              {d.hostname && (
                <Row k="Network name" mono>
                  {d.hostname}
                </Row>
              )}
              <Row k="Address" mono>
                {d.ip}
              </Row>
              <Row k="Hardware ID" mono>
                {d.mac ?? "unknown"}
                {privateMac && <span className="ml-2 rounded-full bg-panel-2 px-2 py-px font-sans text-[11.5px] font-semibold text-muted">private</span>}
              </Row>
              {info.rtt !== undefined && <Row k="Response time">{info.rtt} ms{info.rtt > 30 ? " (probably on Wi-Fi far from the router, or asleep)" : info.rtt <= 3 ? " (probably wired)" : ""}</Row>}
              <Row k="Seen">{history.length > 1 ? `In ${seen} of ${history.length} scans` : "In this scan"}</Row>
            </dl>
          </Section>

          {!!info.services?.length && (
            <Section title="What it announces (Bonjour)">
              <ul className="flex flex-wrap gap-1.5">
                {info.services.map((s) => (
                  <li key={s} className="rounded-full border border-line px-2.5 py-1 text-[12.5px] font-semibold" title={s}>
                    {bonjourName(s)}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Why we think it's a ${KIND_NAME[d.kind].toLowerCase()}`}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-muted">
              <span className="flex gap-0.5" aria-hidden>
                {[1, 2, 3].map((n) => (
                  <span key={n} className="h-1.5 w-6 rounded-full" style={{ background: n <= CONFIDENCE[d.confidence] ? "var(--accent)" : "var(--line)" }} />
                ))}
              </span>
              {d.confidence === "sure" ? "Sure" : d.confidence === "likely" ? "Probably" : "A guess"}
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px] text-muted">
              {d.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Section>
        </div>
      )}

      {tab === "Fix" && (
        <div role="tabpanel" aria-label="Fix">
          <Section title={issues.length ? `What to do (${left.length} left)` : "Nothing to do"}>
            {issues.length ? <ul className="space-y-3">{issues.map(issueRow)}</ul> : <p className="text-[14.5px] text-muted">It looks fine. Nothing it answers on is risky for a {KIND_NAME[d.kind].toLowerCase()}.</p>}
            {notes.map((i) => (
              <p key={i.id} className="mt-3 text-[14px] text-muted">
                <span className="font-semibold text-ink">{i.title}.</span> {i.why}
              </p>
            ))}
          </Section>
        </div>
      )}

      {tab === "Services" && (
        <div role="tabpanel" aria-label="Services">
          <Section title="What it answers on the network">
            {d.ports.length ? (
              <ul className="divide-y divide-line">
                {d.ports.map((p) => {
                  const w = info.web?.find((x) => x.port === p.port);
                  const t = info.tls?.find((x) => x.port === p.port);
                  const risky = d.issues.find((i) => i.port === p.port && i.severity !== "info");
                  const expired = t?.expires && Date.parse(t.expires) < Date.now();
                  return (
                    <li key={`${p.proto}${p.port}`} className="py-2.5">
                      <div className="flex items-baseline gap-3">
                        <span className="w-16 shrink-0 font-mono text-[13px] text-faint">
                          {p.port}
                          {p.proto === "udp" ? "/udp" : ""}
                        </span>
                        <span className="min-w-0 flex-1 font-semibold">{serviceName(p)}</span>
                        {risky && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: toneOf(risky.severity) }} title={risky.title} />}
                      </div>
                      <div className="ml-[4.75rem] space-y-0.5 text-[13px] text-muted">
                        {(p.product || p.banner) && <div>{[p.product, p.version].filter(Boolean).join(" ") || p.banner}</div>}
                        {w && (
                          <div>
                            {w.title ? `Page: "${w.title}"` : "Web page"}
                            {w.status ? `, answers ${w.status}` : ""}
                            {w.server ? `, runs ${w.server}` : ""}
                            {w.login && <span className="ml-1.5 rounded-full bg-[color-mix(in_oklab,var(--warn)_18%,transparent)] px-2 py-px text-[11.5px] font-semibold text-warn">asks for a password</span>}
                          </div>
                        )}
                        {t && (
                          <div>
                            Certificate for {t.subject ?? "unknown"}, from {t.selfSigned ? "itself (self-signed)" : (t.issuer ?? "unknown")}
                            {t.expires && <span className={expired ? "font-semibold text-risk" : ""}>, {expired ? "expired" : "valid until"} {new Date(t.expires).toLocaleDateString()}</span>}
                          </div>
                        )}
                        {(w || [80, 443, 8080, 8443, 5000, 5001, 8123].includes(p.port)) && p.proto === "tcp" && (
                          <a className="font-semibold text-accent" href={`${t || [443, 5001, 8443].includes(p.port) ? "https" : "http"}://${d.ip}:${p.port}/`} target="_blank" rel="noreferrer">
                            Open it (works on the same Wi-Fi)
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[14px] text-muted">Nothing. It doesn't accept connections from other devices, which is good.</p>
            )}
          </Section>
        </div>
      )}

      {tab === "History" && (
        <div role="tabpanel" aria-label="History">
          <Section title="In each scan of this home">
            <ol className="border-l-2 border-line pl-5">
              {history.map((h, n) => {
                const prev = history.slice(0, n).reverse().find((x) => x.device)?.device;
                const opened = h.device && prev ? h.device.ports.filter((p) => !prev.ports.some((q) => q.port === p.port)) : [];
                const closed = h.device && prev ? prev.ports.filter((p) => !h.device!.ports.some((q) => q.port === p.port)) : [];
                const first = h.device && !prev;
                return (
                  <li key={h.scan.id} className="relative pb-4">
                    <span className="absolute -left-[27px] top-1 h-3.5 w-3.5 rounded-full border-2 bg-panel" style={{ borderColor: h.device ? "var(--accent)" : "var(--faint)" }} aria-hidden />
                    <div className="font-semibold">{h.scan.name}</div>
                    <div className="text-[12.5px] text-faint">{new Date(h.scan.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</div>
                    <div className="mt-0.5 text-[13.5px] text-muted">
                      {!h.device ? "Not on the network." : first ? `First seen, at ${h.device.ip}.` : prev && prev.ip !== h.device.ip ? `Moved from ${prev.ip} to ${h.device.ip}.` : `There, at ${h.device.ip}.`}
                      {opened.length > 0 && <span className="text-warn"> Started answering on {opened.map((p) => serviceName(p)).join(", ")}.</span>}
                      {closed.length > 0 && <span> Stopped answering on {closed.map((p) => serviceName(p)).join(", ")}.</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
            {history.length < 2 && <p className="text-[13.5px] text-muted">Scan again another day to see how this device changes.</p>}
          </Section>
        </div>
      )}

      {tab === "Raw" && (
        <div role="tabpanel" aria-label="Raw">
          <Section title="Everything the scan recorded" aside={<CopyButton text={JSON.stringify(stripReport(d), null, 2)} />}>
            <pre className="max-h-[50vh] overflow-auto rounded-xl bg-panel-2 p-3 font-mono text-[12px] leading-relaxed">{JSON.stringify(stripReport(d), null, 2)}</pre>
          </Section>
        </div>
      )}
    </div>
  );
}

/** The device as the scan saw it, without Lamplight's own conclusions. */
const stripReport = (d: DeviceReport) => {
  const { kind, confidence, reasons, issues, worst, ...raw } = d;
  void [kind, confidence, reasons, issues, worst];
  return raw;
};

export { CopyButton };
