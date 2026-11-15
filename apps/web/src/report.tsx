import { KIND_NAME, SEVERITY_RANK, type DeviceReport, type Issue, type Severity } from "@lamplight/core";
import { activity, displayName, gradeOf, issueKey, keyOf, scoreOf, useDone, useHome, usePlaces } from "./lib";
import { WHEN } from "./sheets";

/*
 * A plain, printable security report for the whole home: a white document you can read, share,
 * or save as a PDF with your browser's Print. It always renders light on white, whatever the
 * app's theme, because that is what prints and shares cleanly.
 */

const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium", low: "Low", info: "Note" };
const SEV_DOT: Record<Severity, string> = { critical: "#d92f3d", high: "#e4572e", medium: "#c27800", low: "#2a6fd6", info: "#5b5b63" };

function Dot({ s }: { s: Severity }) {
  return <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 9, background: SEV_DOT[s] }} />;
}

export function ReportPage({ onClose }: { onClose: () => void }) {
  const { report, now } = useHome();
  const places = usePlaces();
  const done = useDone();
  const name = (d: DeviceReport) => displayName(d, places[keyOf(d)]);
  const openIssues = (d: DeviceReport) => d.issues.filter((i) => i.severity !== "info" && !done[issueKey(keyOf(d), i)]);

  const scores = report.devices.map((d) => scoreOf(openIssues(d)));
  const net = report.network.filter((i) => i.severity !== "info" && !done[issueKey(undefined, i)]);
  const grade = Math.max(0, Math.round((scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)) * 0.6 + Math.min(...scores, 100) * 0.4) - net.reduce((n, i) => n + (i.severity === "medium" ? 8 : 3), 0));

  const all = [...report.devices.flatMap((d) => openIssues(d).map((i) => ({ i, d }))), ...net.map((i) => ({ i, d: undefined as DeviceReport | undefined }))];
  const bySev = (["critical", "high", "medium", "low"] as const).map((s) => [s, all.filter((x) => x.i.severity === s).length] as const);
  const cves = [...new Set(all.map((x) => x.i.cve).filter(Boolean))] as string[];
  const exposed = report.scan.internet?.mappings?.filter((m) => m.enabled !== false).length ?? 0;
  const ranked = [...report.devices].map((d) => ({ d, open: openIssues(d) })).sort((a, b) => scoreOf(a.open) - scoreOf(b.open));

  const issueBlock = (i: Issue, d?: DeviceReport) => (
    <div key={(d ? d.ip : "net") + i.id + i.port} className="rp-issue">
      <div className="rp-issue-head">
        <Dot s={i.severity} />
        <strong>{i.title}</strong>
        <span className="rp-tag">{SEV_LABEL[i.severity]}</span>
        {i.cve && (
          <a href={`https://nvd.nist.gov/vuln/detail/${i.cve}`} target="_blank" rel="noreferrer" className="rp-cve">
            {i.cve}
          </a>
        )}
        <span className="rp-when">{WHEN[i.severity]}</span>
      </div>
      <div className="rp-where">{d ? `${name(d)} · ${d.ip}` : "Whole network"}</div>
      <p className="rp-why">{i.why}</p>
      <ol className="rp-steps">
        {i.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
    </div>
  );

  return (
    <div className="rp-backdrop" data-ui>
      <div className="rp-bar">
        <button className="btn" onClick={onClose}>
          ← Back
        </button>
        <div className="rp-bar-title">Security report</div>
        <button className="btn btn-accent" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>

      <article className="rp-doc">
        <header className="rp-header">
          <div>
            <h1>Home network security report</h1>
            <p className="rp-sub">
              {report.scan.network ?? "Your network"} · {new Date(now.scan.at).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })} · {report.devices.length} devices
            </p>
          </div>
          <div className="rp-grade" style={{ borderColor: grade >= 75 ? "#148a52" : grade >= 50 ? "#c27800" : "#d92f3d" }}>
            <div className="rp-grade-letter" style={{ color: grade >= 75 ? "#148a52" : grade >= 50 ? "#c27800" : "#d92f3d" }}>
              {gradeOf(grade)}
            </div>
            <div className="rp-grade-num">{grade}/100</div>
          </div>
        </header>

        <section className="rp-cards">
          {bySev.map(([s, n]) => (
            <div key={s} className="rp-card">
              <div className="rp-card-n" style={{ color: SEV_DOT[s] }}>
                {n}
              </div>
              <div className="rp-card-l">{SEV_LABEL[s]}</div>
            </div>
          ))}
          <div className="rp-card">
            <div className="rp-card-n">{exposed}</div>
            <div className="rp-card-l">Open to internet</div>
          </div>
        </section>

        <p className="rp-lead">
          {all.length === 0 ? "Nothing needs fixing right now — every device looks fine." : `This network has ${all.length} thing${all.length === 1 ? "" : "s"} to fix across ${ranked.filter((r) => r.open.length).length} device${ranked.filter((r) => r.open.length).length === 1 ? "" : "s"}. Start at the top: the weakest devices and anything open to the internet matter most.`}
          {cves.length > 0 && ` ${cves.length} match a published vulnerability (${cves.join(", ")}).`}
        </p>

        <h2>Devices, weakest first</h2>
        <table className="rp-table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Type</th>
              <th>Address</th>
              <th>Doing</th>
              <th className="rp-right">To fix</th>
              <th className="rp-right">Grade</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map(({ d, open }) => (
              <tr key={d.ip}>
                <td>
                  <strong>{name(d)}</strong>
                  {d.details?.model ? <span className="rp-muted"> · {d.details.model}</span> : null}
                </td>
                <td>{KIND_NAME[d.kind]}</td>
                <td className="rp-mono">{d.ip}</td>
                <td className="rp-muted">{activity(d)}</td>
                <td className="rp-right">{open.length || "—"}</td>
                <td className="rp-right" style={{ color: scoreOf(open) >= 90 ? "#148a52" : scoreOf(open) >= 55 ? "#c27800" : "#d92f3d", fontWeight: 700 }}>
                  {gradeOf(scoreOf(open))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {all.length > 0 && (
          <>
            <h2 className="rp-break">What to do, most urgent first</h2>
            {[...all].sort((a, b) => SEVERITY_RANK[b.i.severity] - SEVERITY_RANK[a.i.severity]).map(({ i, d }) => issueBlock(i, d))}
          </>
        )}

        <footer className="rp-foot">
          Made with Lamplight. Detection is best-effort and not a full audit — a device without a problem here may still have one. {report.scan.source === "lamplight" ? "" : "This report is from an imported scan."} Scans and this report stay in your browser.
        </footer>
      </article>
    </div>
  );
}
