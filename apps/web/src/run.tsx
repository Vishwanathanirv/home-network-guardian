import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { analyse, DEMO_XML_TONIGHT, isPrivate, parseAny } from "@lamplight/core";
import { CopyButton } from "./device";
import { addScan, removeScan, setActive, useActive, useScans } from "./lib";
import { Section, SubHeader } from "./sheets";

const RAW = "https://raw.githubusercontent.com/Vishwanathanirv/home-network-guardian/main/scanner/lamplight.cjs";
type Os = "windows" | "mac" | "linux";
const OS_NAME: Record<Os, string> = { windows: "Windows", mac: "Mac", linux: "Linux" };

const guessOs = (): Os => {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return /windows/i.test(ua) ? "windows" : /mac os/i.test(ua) ? "mac" : "linux";
};

/** A command in a terminal-style box, with a copy button. */
export function Cmd({ os, children }: { os: Os; children: string }) {
  return (
    <div className="group relative mt-1.5 rounded-xl border border-line bg-[#070b0e]">
      <pre className="whitespace-pre-wrap break-all px-3 py-2.5 pr-[4.5rem] font-mono text-[12.5px] leading-relaxed text-[#d7e3ea]">
        {children.split("\n").map((l, i) => (
          <span key={i} className="block">
            <span className="select-none text-faint">{os === "windows" ? "> " : "$ "}</span>
            {l}
          </span>
        ))}
      </pre>
      <span className="absolute right-2 top-2">
        <CopyButton text={children} />
      </span>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[12px] font-bold text-panel">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-6">{title}</h3>
        <div className="text-[13.5px] leading-relaxed text-muted">{children}</div>
      </div>
    </li>
  );
}

/** Turns "10.101.250.38" (or a network) into 10.101.250.0/24. */
export function networkFrom(text: string): string | null {
  const m = text.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/);
  if (!m || m.slice(1, 5).some((x) => +x > 255) || !isPrivate(m.slice(1, 5).join("."))) return null;
  return `${m[1]}.${m[2]}.${m[3]}.0/24`;
}

export function ScansSheet({ onClose }: { onClose: () => void }) {
  const scans = useScans();
  const active = useActive();
  const navigate = useNavigate();
  const [os, setOs] = useState<Os>(guessOs);
  const [addr, setAddr] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cidr = networkFrom(addr);
  const net = cidr ?? "192.168.1.0/24";

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
    <div>
      <SubHeader title="Scan your home" onClose={onClose}>
        <p className="mt-1 text-[13.5px] leading-snug text-muted">A website can't see your home network, so the scan runs on a computer in your house. Copy these commands into a terminal, then open the result here. Nothing is uploaded.</p>
      </SubHeader>

      <div className="mt-4 flex gap-1 rounded-full bg-panel-2 p-1" role="tablist" aria-label="Your computer">
        {(Object.keys(OS_NAME) as Os[]).map((o) => (
          <button key={o} role="tab" aria-selected={os === o} onClick={() => setOs(o)} className={`flex-1 rounded-full py-1.5 text-[13.5px] font-semibold ${os === o ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {OS_NAME[o]}
          </button>
        ))}
      </div>

      <ol className="mt-4 space-y-4">
        <Step n={1} title={`Open a terminal`}>
          {os === "windows" ? (
            <>
              Press the Windows key, type <b className="text-ink">cmd</b> and press Enter. Then check Node.js is installed (version 20 or newer); if not, get it from{" "}
              <a className="font-semibold text-accent" href="https://nodejs.org" target="_blank" rel="noreferrer">
                nodejs.org
              </a>
              .
            </>
          ) : (
            <>
              Open {os === "mac" ? "Terminal (in Applications, Utilities)" : "a terminal"} and check Node.js is installed (version 20 or newer). If not, get it from{" "}
              <a className="font-semibold text-accent" href="https://nodejs.org" target="_blank" rel="noreferrer">
                nodejs.org
              </a>
              .
            </>
          )}
          <Cmd os={os}>node -v</Cmd>
        </Step>
        <Step n={2} title="Download the scanner">
          One file, no install. It saves next to where your terminal is.
          <Cmd os={os}>{`${os === "windows" ? "curl.exe" : "curl"} -L -o lamplight.cjs ${RAW}`}</Cmd>
        </Step>
        <Step n={3} title="Find your network">
          This lists the networks your computer is on and marks the one with your router. Virtual ones (VirtualBox, VMware, WSL, Docker) are skipped.
          <Cmd os={os}>node lamplight.cjs networks</Cmd>
          <label className="mt-2.5 block text-[13px] font-semibold text-ink">
            Or type your computer's address to fill in the next step
            <input className="field mt-1 py-1.5 font-mono text-[13.5px]" placeholder={os === "windows" ? "From ipconfig, like 10.101.250.38" : "Like 192.168.1.20"} value={addr} onChange={(e) => setAddr(e.target.value)} aria-label="Your computer's address" />
          </label>
          {addr && !cidr && <p className="mt-1 text-[12.5px] text-warn">That isn't a home network address. It should start with 192.168, 10. or 172.16 to 172.31.</p>}
          <p className="mt-1.5 text-[12.5px]">
            Don't know it? {os === "windows" ? "Run ipconfig and look for IPv4 Address under Wireless LAN adapter Wi-Fi." : os === "mac" ? "Run ipconfig getifaddr en0." : "Run ip -4 addr and look at your Wi-Fi or Ethernet."}
          </p>
        </Step>
        <Step n={4} title="Scan">
          About a minute. It finds each device, asks it its name and model, reads its web page and certificate, and checks the services it answers on. It never logs in to anything.
          <Cmd os={os}>{`node lamplight.cjs scan --network ${net}`}</Cmd>
          {os === "windows" && <p className="mt-1.5 text-[12.5px]">If Windows asks about the firewall for Node.js, click Allow, so devices can answer.</p>}
        </Step>
        <Step n={5} title="Open the result here">
          It saves a file named like <code className="font-mono text-ink">lamplight-{new Date().toISOString().slice(0, 10)}.json</code>. Choose it below.
        </Step>
      </ol>

      <Section title="Open a scan">
        <div className="flex flex-wrap gap-2">
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
        </div>
        <textarea className="field mt-2 h-24 font-mono text-[12.5px]" spellCheck={false} placeholder="Or paste scan JSON, nmap XML or the output of arp -a" value={text} onChange={(e) => setText(e.target.value)} aria-label="Scan contents" />
        {error && (
          <p className="mt-1.5 text-[14px] font-semibold text-risk" role="alert">
            {error}
          </p>
        )}
        <button className="btn mt-2" disabled={!text.trim()} onClick={() => load(`Pasted ${new Date().toLocaleDateString()}`, text)}>
          Show it on the plan
        </button>
      </Section>

      <Section title="Try the commands without scanning">
        <p className="text-[13.5px] text-muted">Saves the example home as a scan file and prints its report, so you can see what a scan gives you first.</p>
        <Cmd os={os}>{"node lamplight.cjs demo\nnode lamplight.cjs report lamplight-demo.json"}</Cmd>
      </Section>

      <Section title="More commands">
        <dl className="space-y-3 text-[13.5px]">
          {(
            [
              ["Print the to-do list for a scan", "node lamplight.cjs report lamplight-2026-11-15.json"],
              ["See what changed between two scans", "node lamplight.cjs compare last-week.json tonight.json"],
              ["Choose the file name", `node lamplight.cjs scan --network ${net} --out tonight.json`],
              ["Check only some services", `node lamplight.cjs scan --network ${net} --ports 22,23,80,443,554,5555`],
              ["Get the report as JSON, for other tools", "node lamplight.cjs report tonight.json --json"],
              ["All options", "node lamplight.cjs --help"],
            ] as const
          ).map(([t, c]) => (
            <div key={t}>
              <dt className="font-semibold">{t}</dt>
              <dd>
                <Cmd os={os}>{c}</Cmd>
              </dd>
            </div>
          ))}
          <div>
            <dt className="font-semibold">Scan every night and get told about new devices</dt>
            <dd className="text-muted">
              {os === "windows" ? "Windows Task Scheduler runs it at 2am; compare exits with code 1 when a device joins." : "cron runs it at 2am; compare exits with code 1 when a device joins, so cron can mail you."}
              <Cmd os={os}>{os === "windows" ? `schtasks /create /sc daily /st 02:00 /tn Lamplight /tr "node %USERPROFILE%\\lamplight.cjs scan --network ${net} --out %USERPROFILE%\\today.json"` : `(crontab -l; echo "0 2 * * * cd ~ && node lamplight.cjs scan --network ${net} --out today.json >/dev/null && node lamplight.cjs compare last.json today.json; mv today.json last.json") | crontab -`}</Cmd>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title="Other ways in">
        <dl className="space-y-3 text-[13.5px]">
          <div>
            <dt className="font-semibold">nmap, if you have it</dt>
            <dd className="text-muted">
              Lamplight reads its XML. Without the Lamplight scanner there are no names, models or certificates.
              <Cmd os={os}>{`${os === "windows" ? "" : "sudo "}nmap -sV -O -oX scan.xml ${net}`}</Cmd>
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Your ARP table: no scanning at all</dt>
            <dd className="text-muted">
              Lists devices your computer has talked to recently, without their services. Paste the output above.
              <Cmd os={os}>{os === "linux" ? "ip neigh" : "arp -a"}</Cmd>
            </dd>
          </div>
        </dl>
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
                  {new Date(s.scan.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}, {s.scan.devices.length} device{s.scan.devices.length === 1 ? "" : "s"}
                  {s.scan.network ? ` on ${s.scan.network}` : ""}, {r.issues.filter((i) => i.severity !== "info").length} to fix
                </div>
                <div className="mt-1.5 flex gap-1 text-[13px]" role="group" aria-label={`Use ${s.name} as`}>
                  <button className={`rounded-full px-3 py-1 font-semibold ${active.now === s.id ? "bg-ink text-bg" : "bg-panel-2 text-muted hover:text-ink"}`} onClick={() => setActive({ now: s.id, before: active.before === s.id ? null : active.before })} aria-pressed={active.now === s.id}>
                    Now
                  </button>
                  <button className={`rounded-full px-3 py-1 font-semibold ${active.before === s.id ? "bg-ink text-bg" : "bg-panel-2 text-muted hover:text-ink"}`} onClick={() => setActive({ now: active.now === s.id ? (active.before ?? s.id) : active.now, before: active.before === s.id ? null : s.id })} aria-pressed={active.before === s.id}>
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
