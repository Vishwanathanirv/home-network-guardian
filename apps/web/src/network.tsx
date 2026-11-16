import { useState } from "react";
import { useNavigate } from "react-router";
import { isCgnat, isPrivate, KIND_NAME, serviceName, wifiVerdict, type DeviceReport, type Internet, type Kind, type Report } from "@lamplight/core";
import { ScoreRing } from "./device";
import { displayName, gradeOf, issueKey, keyOf, scoreOf, useDone, useHome, usePlaces } from "./lib";
import { toneOf } from "./plan";
import { DeviceRow, Section, SubHeader, WHEN } from "./sheets";

function Bars({ rows }: { rows: { label: string; n: number; tone?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,9.5rem)_1fr_1.75rem] items-center gap-2.5 text-[13.5px]">
          <span className="truncate">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-panel-2">
            <span className="block h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: r.tone ?? "var(--accent)" }} />
          </span>
          <span className="text-right font-semibold tabular-nums">{r.n}</span>
        </li>
      ))}
    </ul>
  );
}

const count = <T,>(items: T[], key: (t: T) => string | undefined) => {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = key(i);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
};

/** A plain-text report anyone can read, to keep or send. */
function markdown(r: Report, name: (d: DeviceReport) => string, done: Record<string, number>) {
  const lines = [`# Lamplight report`, ``, `${r.devices.length} devices${r.scan.network ? ` on ${r.scan.network}` : ""}, scanned ${new Date(r.scan.at).toLocaleString()}.`, ``, `## Devices`, ``, `| Device | Type | Address | Hardware ID | To fix |`, `| --- | --- | --- | --- | --- |`];
  for (const d of r.devices) lines.push(`| ${name(d)}${d.details?.model ? ` (${d.details.model})` : ""} | ${KIND_NAME[d.kind]} | ${d.ip} | ${d.mac ?? ""} | ${d.issues.filter((i) => i.severity !== "info" && !done[issueKey(keyOf(d), i)]).length} |`);
  lines.push(``, `## What to do`);
  for (const i of r.issues.filter((x) => x.severity !== "info")) {
    const d = r.devices.find((x) => x.ip === i.ip);
    const k = issueKey(d ? keyOf(d) : undefined, i);
    lines.push(``, `### ${done[k] ? "~~" : ""}${i.title}${done[k] ? "~~ (done)" : ""}`, ``, `${d ? name(d) : "Whole network"}, ${WHEN[i.severity].toLowerCase()}.`, ``, i.why, ``, ...i.steps.map((s) => `- ${s}`));
  }
  return lines.join("\n") + "\n";
}

function save(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const rate = (ms: number | undefined, good: number, ok: number) => (ms === undefined ? ["–", "no answer", "var(--faint)"] : ms <= good ? [`${ms} ms`, "good", "var(--ok)"] : ms <= ok ? [`${ms} ms`, "fine", "var(--warn)"] : [`${ms} ms`, "slow", "var(--risk)"]);

/** The internet side: speed, steadiness, honest DNS, and doors the router opened to the internet. */
function InternetPanel({ net, report, onPick, name }: { net?: Internet; report: Report; onPick: (ip: string) => void; name: (d: DeviceReport) => string }) {
  const [show, setShow] = useState(false);
  if (!net) return <p className="text-[13.5px] text-muted">Scan with the Lamplight scanner to see your connection's speed, whether its DNS is honest, and which doors your router opened to the internet.</p>;
  const tiles = [
    ["Router", ...rate(net.routerMs, 5, 20)],
    ["Internet", ...rate(net.internetMs, 40, 120)],
    ["Steadiness", ...(net.jitterMs === undefined ? ["–", "unknown", "var(--faint)"] : net.jitterMs <= 5 ? [`±${net.jitterMs} ms`, "steady", "var(--ok)"] : net.jitterMs <= 20 ? [`±${net.jitterMs} ms`, "a bit jumpy", "var(--warn)"] : [`±${net.jitterMs} ms`, "jumpy: calls may stutter", "var(--risk)"])],
    ["Name lookups", ...rate(net.dnsMs, 40, 150)],
  ];
  const ip = net.externalIp;
  const shared = !!ip && (isCgnat(ip) || isPrivate(ip));
  const maps = net.mappings ?? [];
  return (
    <div>
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map(([k, v, word, tone]) => (
          <div key={k} className="rounded-xl border border-line p-2.5">
            <dt className="text-[12px] font-semibold text-faint">{k}</dt>
            <dd className="text-[16px] font-bold tabular-nums">{v}</dd>
            <dd className="text-[12px] font-semibold" style={{ color: tone }}>
              {word}
            </dd>
          </div>
        ))}
      </dl>
      <dl className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[14px]">
        {ip && (
          <>
            <dt className="text-faint">Internet address</dt>
            <dd>
              <span className="font-mono">{show ? ip : ip.replace(/\.\d+\.\d+$/, ".•••.•••")}</span>{" "}
              <button className="text-[12.5px] font-semibold text-accent" onClick={() => setShow(!show)}>
                {show ? "Hide" : "Show"}
              </button>
              {shared && <span className="block text-[12.5px] text-muted">Shared with other homes by your provider (carrier-grade NAT), so nobody on the internet can reach your devices directly.</span>}
            </dd>
          </>
        )}
        {net.wifi && (
          <>
            <dt className="text-faint">Wi-Fi lock</dt>
            <dd style={{ color: { ok: undefined, warn: "var(--warn)", risk: "var(--risk)" }[wifiVerdict(net.wifi.security).tone] }}>
              {wifiVerdict(net.wifi.security).word}
              <span className="block text-[12.5px] text-muted">{net.wifi.ssid ? `${net.wifi.ssid}, ` : ""}{net.wifi.security}</span>
            </dd>
          </>
        )}
        {net.nxdomainHijack !== undefined && (
          <>
            <dt className="text-faint">DNS</dt>
            <dd style={{ color: net.nxdomainHijack ? "var(--warn)" : undefined }}>{net.nxdomainHijack ? "Makes up answers for websites that don't exist" : "Answers honestly"}</dd>
          </>
        )}
      </dl>
      <h3 className="mt-4 text-[13px] font-bold">{maps.length ? `${maps.length} door${maps.length === 1 ? "" : "s"} open to the internet` : "No doors open to the internet"}</h3>
      {maps.length ? (
        <ul className="mt-1.5 divide-y divide-line">
          {maps.map((m) => {
            const d = report.devices.find((x) => x.ip === m.client);
            const issue = d?.issues.find((i) => i.id === "upnp-mapping" && i.port === m.internalPort);
            return (
              <li key={`${m.protocol}${m.externalPort}`} className="flex items-start gap-2.5 py-2 text-[13.5px]">
                <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: issue?.severity === "critical" ? "var(--risk)" : issue?.severity === "low" ? "var(--faint)" : "var(--warn)" }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div>
                    <span className="font-mono text-faint">
                      {m.protocol} {m.externalPort}
                    </span>{" "}
                    → {d ? <button className="font-semibold text-accent" onClick={() => onPick(d.ip)}>{name(d)}</button> : <span className="font-mono">{m.client}</span>}, {serviceName({ port: m.internalPort, proto: m.protocol === "UDP" ? "udp" : "tcp" })}
                  </div>
                  {m.description && <div className="text-[12.5px] text-muted">Opened by "{m.description}"</div>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-1 text-[13px] text-muted">{net.mappings ? "Your router reports no UPnP port forwards." : "The router didn't answer UPnP questions, which usually means UPnP is off. Good."}</p>
      )}
    </div>
  );
}

export function NetworkSheet({ onClose, onPick }: { onClose: () => void; onPick: (ip: string) => void }) {
  const navigate = useNavigate();
  const { report, now } = useHome();
  const places = usePlaces();
  const done = useDone();
  const name = (d: DeviceReport) => displayName(d, places[keyOf(d)]);
  const leftOf = (d: DeviceReport) => d.issues.filter((i) => i.severity !== "info" && !done[issueKey(keyOf(d), i)]);
  const netLeft = report.network.filter((i) => i.severity !== "info" && !done[issueKey(undefined, i)]);
  // The network is as safe as its weakest devices: average the scores, then take off whole-network problems.
  const scores = report.devices.map((d) => scoreOf(leftOf(d)));
  const score = Math.max(0, Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 0.6 + Math.min(...scores, 100) * 0.4) - netLeft.reduce((n, i) => n + (i.severity === "medium" ? 8 : 3), 0));
  const atRisk = report.devices
    .map((d) => ({ d, s: scoreOf(leftOf(d)) }))
    .filter((x) => x.s < 100)
    .sort((a, b) => a.s - b.s)
    .slice(0, 5);
  const router = report.devices.find((d) => d.ip === report.scan.gateway);
  const services = count(
    report.devices.flatMap((d) => d.ports.map((p) => ({ d, p }))),
    (x) => serviceName(x.p),
  ).slice(0, 10);
  const risky = new Set(report.issues.filter((i) => i.port).map((i) => serviceName({ port: i.port!, proto: "tcp" })));
  const kinds = count(report.devices, (d) => KIND_NAME[d.kind as Kind]);
  const makers = count(report.devices, (d) => d.details?.maker ?? d.vendor ?? (d.mac && /^[0-9A-F][26AE]/i.test(d.mac) ? "Hidden (private address)" : "Unknown")).slice(0, 6);
  const named = report.devices.filter((d) => d.details?.name || d.details?.model).length;
  const rtts = report.devices.map((d) => d.details?.rtt).filter((x): x is number => x !== undefined);

  return (
    <div>
      <SubHeader title="Your network" onClose={onClose}>
        <p className="mt-1 text-[13.5px] text-muted">
          {report.scan.network ?? "Network"}, from {now.name.toLowerCase()} ({new Date(now.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })})
        </p>
      </SubHeader>

      <div className="mt-4 flex items-center gap-4 rounded-2xl bg-panel-2 p-3.5">
        <ScoreRing score={score} size={68} />
        <div className="min-w-0">
          <div className="text-[1.05rem] font-bold">Safety grade {gradeOf(score)}</div>
          <p className="text-[13.5px] leading-snug text-muted">
            {atRisk.length ? `${atRisk.length === 5 ? "At least 5" : atRisk.length} device${atRisk.length === 1 ? "" : "s"} need${atRisk.length === 1 ? "s" : ""} attention. Fixing the weakest one raises the grade most.` : "Nothing left to fix. Scan again after new devices join."}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          [String(report.devices.length), "devices"],
          [String(report.devices.reduce((n, d) => n + d.ports.length, 0)), "open services"],
          [rtts.length ? `${Math.round(rtts.sort((a, b) => a - b)[Math.floor(rtts.length / 2)])} ms` : "–", "typical response"],
        ].map(([v, l]) => (
          <div key={l} className="rounded-xl border border-line py-2">
            <dt className="sr-only">{l}</dt>
            <dd className="text-[17px] font-bold tabular-nums">{v}</dd>
            <dd className="text-[11.5px] font-semibold text-faint">{l}</dd>
          </div>
        ))}
      </dl>

      <Section title="The internet side">
        <InternetPanel net={report.scan.internet} report={report} onPick={onPick} name={name} />
      </Section>

      {router && (
        <Section title="Your router">
          <DeviceRow d={router} onPick={onPick} left={leftOf(router).length} />
          <p className="mt-1 px-2 text-[13px] text-muted">
            {router.details?.model ? `${router.details.model}${router.details.maker ? ` by ${router.details.maker}` : ""}. ` : ""}Every device's traffic goes through it, so its problems count double.
          </p>
        </Section>
      )}

      {atRisk.length > 0 && (
        <Section title="Weakest devices">
          <ul className="space-y-0.5">
            {atRisk.map(({ d }) => (
              <li key={d.ip}>
                <DeviceRow d={d} onPick={onPick} left={leftOf(d).length} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {netLeft.length > 0 && (
        <Section title="For the whole network">
          {netLeft.map((i) => (
            <div key={i.id} className="flex gap-2.5">
              <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: toneOf(i.severity) }} aria-hidden />
              <div>
                <div className="font-semibold">{i.title}</div>
                <p className="text-[13.5px] text-muted">{i.why}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      <Section title="What's on it">
        <Bars rows={kinds.map(([label, n]) => ({ label, n }))} />
      </Section>
      <Section title="Who made them">
        <Bars rows={makers.map(([label, n]) => ({ label, n, tone: "var(--muted)" }))} />
        <p className="mt-2 text-[12.5px] text-faint">
          {named} of {report.devices.length} devices told the scanner their own name or model.
        </p>
      </Section>
      {services.length > 0 && (
        <Section title="Services answering">
          <Bars rows={services.map(([label, n]) => ({ label, n, tone: risky.has(label) ? "var(--warn)" : "var(--accent)" }))} />
          <p className="mt-2 text-[12.5px] text-faint">Orange ones have something to fix on at least one device.</p>
        </Section>
      )}

      <Section title="Keep a copy">
        <button className="btn btn-accent mb-2 w-full" onClick={() => navigate("/report")}>
          Open the full security report
        </button>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => save(`lamplight-report-${now.scan.at.slice(0, 10)}.md`, markdown(report, name, done), "text/markdown")}>
            Download the report
          </button>
          <button className="btn" onClick={() => save(`lamplight-${now.scan.at.slice(0, 10)}.json`, JSON.stringify(now.scan, null, 2), "application/json")}>
            Download the scan
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] text-faint">The report is plain text with every device and every step, ready to print or send.</p>
      </Section>
    </div>
  );
}
