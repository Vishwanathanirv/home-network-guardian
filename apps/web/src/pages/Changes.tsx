import { Link } from "react-router";
import { serviceName, type Change } from "@lamplight/core";
import { displayName, keyOf, useHome, usePlaces } from "../lib";

const TEXT: Record<Change["type"], string> = { joined: "Joined the network", left: "Not seen this time", moved: "Got a new address", opened: "Started answering on", closed: "Stopped answering on" };

export function Changes() {
  const { report, changes, now, before } = useHome();
  const places = usePlaces();
  if (!before)
    return (
      <div className="max-w-2xl">
        <h1 className="text-[2.2rem] font-bold">What changed</h1>
        <p className="mt-3 text-muted">
          Pick an earlier scan as "before" on the <Link to="/scans" className="font-semibold text-accent underline underline-offset-4">scans page</Link> to see what changed since then.
        </p>
      </div>
    );
  const order: Change["type"][] = ["joined", "opened", "moved", "closed", "left"];
  const sorted = [...changes].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
  return (
    <div className="max-w-3xl">
      <h1 className="text-[2.2rem] font-bold leading-[1.1] tracking-[-0.015em]">What changed</h1>
      <p className="mt-3 text-[1.05rem] leading-relaxed text-muted">
        Between {before.name.toLowerCase()} ({new Date(before.scan.at).toLocaleDateString()}) and {now.name.toLowerCase()} ({new Date(now.scan.at).toLocaleDateString()}). A new device you don't recognise is the most important thing to check: it may be a neighbour on your Wi-Fi.
      </p>
      {sorted.length ? (
        <ol className="mt-6 border-l-2 border-line pl-6">
          {sorted.map((c, i) => {
            const d = report.devices.find((x) => keyOf(x) === keyOf(c.device));
            const name = d ? displayName(d, places[keyOf(d)]) : c.device.hostname ?? c.device.ip;
            const tone = c.type === "joined" || c.type === "opened" ? "var(--warn)" : "var(--faint)";
            return (
              <li key={i} className="relative pb-6">
                <span className="absolute -left-[33px] top-1 h-4 w-4 rounded-full border-2 bg-panel" style={{ borderColor: tone }} aria-hidden />
                <div className="text-sm font-bold" style={{ color: tone }}>
                  {TEXT[c.type]}
                  {(c.type === "opened" || c.type === "closed") && ` ${c.ports.map((p) => serviceName(c.device.ports.find((x) => x.port === p) ?? { port: p, proto: "tcp" })).join(", ")}`}
                </div>
                <div className="mt-0.5 text-lg font-semibold">
                  {d ? (
                    <Link to={`/?device=${d.ip}`} className="underline-offset-4 hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </div>
                <div className="font-mono text-sm text-faint">
                  {c.device.ip}
                  {c.type === "moved" ? ` (was ${c.from})` : ""}
                  {c.device.mac ? `, ${c.device.mac}` : ""}
                </div>
                {d && d.issues.length > 0 && c.type !== "left" && <p className="mt-1 text-sm text-muted">{d.issues[0].title.replace(/[.?!]$/, "")}{/[?!]$/.test(d.issues[0].title) ? d.issues[0].title.slice(-1) : "."}</p>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-6 text-muted">Nothing changed: the same devices, answering on the same services.</p>
      )}
      <section className="card mt-4 p-4">
        <h2 className="font-bold">Get told when a new device joins</h2>
        <p className="mt-1 text-[15px] text-muted">Run the scanner on a schedule (a Raspberry Pi works well) and compare with the last scan. It exits with code 1 when a device joins, so cron can mail you the output.</p>
        <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--bg)] p-3 font-mono text-[13px] leading-relaxed">{`# crontab -e: every night at 2am
0 2 * * * cd ~/lamplight && node lamplight.cjs scan --out today.json >/dev/null && node lamplight.cjs compare last.json today.json; mv today.json last.json`}</pre>
      </section>
    </div>
  );
}
