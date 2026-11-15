import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { analyse, DEMO_XML_TONIGHT, parseAny } from "@lamplight/core";
import { addScan, removeScan, setActive, useActive, useScans } from "../lib";

function Way({ title, children, code }: { title: string; children: ReactNode; code?: string }) {
  return (
    <section className="card p-4">
      <h3 className="font-bold">{title}</h3>
      <div className="mt-1 text-[15px] leading-relaxed text-muted">{children}</div>
      {code && <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--bg)] p-3 font-mono text-[13px] leading-relaxed text-ink">{code}</pre>}
    </section>
  );
}

export function Scans() {
  const scans = useScans();
  const active = useActive();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="max-w-5xl">
      <h1 className="text-[2.2rem] font-bold leading-[1.1] tracking-[-0.015em]">Scan your own home</h1>
      <p className="mt-3 max-w-2xl text-[1.05rem] leading-relaxed text-muted">
        A website can't see your home network, so the scan runs on a computer in your house. You then open the result here. It's read in your browser and saved only in this browser: nothing is uploaded.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Way title="Easiest: the Lamplight scanner" code={"node lamplight.cjs scan"}>
          Download <code className="font-mono text-ink">scanner/lamplight.cjs</code> from the project on GitHub and run it with Node 20 or newer. It finds your network by itself, takes about a minute, and saves a file you open below.
        </Way>
        <Way title="If you use nmap" code={"sudo nmap -sV -O -oX scan.xml 192.168.1.0/24"}>
          Change the address to your network. Running it with <code className="font-mono text-ink">sudo</code> lets nmap read hardware IDs and guess each device's system.
        </Way>
        <Way title="Quickest: your ARP table" code={"arp -a"}>
          Lists the devices your computer has talked to recently, without their services. Works on Windows, Mac and Linux with nothing to install. Copy the output into the box below.
        </Way>
      </div>

      <section className="card mt-6 p-4">
        <h2 className="text-lg font-bold">Open a scan</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="btn primary cursor-pointer">
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
          <span className="text-sm text-muted">or paste it here:</span>
        </div>
        <textarea className="field mt-3 h-40 font-mono text-[13px]" spellCheck={false} placeholder="Paste scan JSON, nmap XML or the output of arp -a" value={text} onChange={(e) => setText(e.target.value)} aria-label="Scan contents" />
        {error && (
          <p className="mt-2 text-sm font-semibold text-risk" role="alert">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn primary" disabled={!text.trim()} onClick={() => load(`Pasted ${new Date().toLocaleDateString()}`, text)}>
            Show it on the plan
          </button>
          <a className="btn" href={`data:application/xml;charset=utf-8,${encodeURIComponent(DEMO_XML_TONIGHT)}`} download="example-scan.xml">
            Download an example nmap file
          </a>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">Your scans</h2>
        <p className="mt-1 text-sm text-muted">The plan shows the scan marked "now" and compares it with the one marked "before", to spot new devices.</p>
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line bg-panel">
          {scans.map((s) => {
            const r = analyse(s.scan);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-sm text-muted">
                    {new Date(s.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}, {s.scan.devices.length} devices, {r.issues.filter((i) => i.severity !== "info").length} things to fix ({s.scan.source === "arp" ? "ARP table" : s.scan.source === "nmap" ? "nmap" : "Lamplight scanner"})
                  </div>
                </div>
                <div className="flex gap-1 text-sm" role="group" aria-label={`Use ${s.name} as`}>
                  <button className={`rounded-md px-2.5 py-1 font-semibold ${active.now === s.id ? "bg-ink text-bg" : "text-muted hover:text-ink"}`} onClick={() => setActive({ now: s.id, before: active.before === s.id ? null : active.before })} aria-pressed={active.now === s.id}>
                    Now
                  </button>
                  <button className={`rounded-md px-2.5 py-1 font-semibold ${active.before === s.id ? "bg-ink text-bg" : "text-muted hover:text-ink"}`} onClick={() => setActive({ now: active.now === s.id ? active.before ?? s.id : active.now, before: active.before === s.id ? null : s.id })} aria-pressed={active.before === s.id}>
                    Before
                  </button>
                  {!s.demo && (
                    <button className="rounded-md px-2.5 py-1 text-muted hover:text-risk" onClick={() => removeScan(s.id)}>
                      Delete
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
