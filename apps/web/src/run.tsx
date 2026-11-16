import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { analyse, DEMO_XML_TONIGHT, isPrivate, parseAny } from "@lamplight/core";
import { CopyButton } from "./device";
import { addScan, removeScan, setActive, useActive, useScans } from "./lib";
import { Section, SubHeader } from "./sheets";

const RAW_BASE = "https://raw.githubusercontent.com/Vishwanathanirv/home-network-guardian/main/scanner";
const RAW = `${RAW_BASE}/lamplight.cjs`;
const LAUNCHER: Record<Os, { file: string; name: string }> = {
  windows: { file: "lamplight-windows.cmd", name: "Windows launcher" },
  mac: { file: "lamplight-mac.command", name: "Mac launcher" },
  linux: { file: "lamplight-mac.command", name: "launcher" },
};

export type Os = "windows" | "mac" | "linux";
const OS_NAME: Record<Os, string> = { windows: "Windows", mac: "Mac", linux: "Linux" };

/** Saves a text file to the user's computer. One file, so no multi-download prompt. */
function saveText(filename: string, text: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the launcher as a single self-contained file: on first run it downloads the scanner
 * next to itself, then runs it pointed at THIS site. So the person only ever downloads one file.
 */
export function launcherText(os: Os): string {
  const cjs = `${RAW_BASE}/lamplight.cjs`;
  const site = typeof location === "undefined" ? "https://home-network-guardian.vercel.app" : location.origin;
  if (os === "windows") {
    return [
      "@echo off",
      "title Lamplight",
      'cd /d "%~dp0"',
      "where node >nul 2>nul",
      "if errorlevel 1 (",
      "  echo.",
      "  echo   Lamplight needs Node.js, which is free.",
      "  echo   1. Get it from https://nodejs.org  ^(the big green LTS button^)",
      "  echo   2. Install it, then double-click this file again.",
      "  echo.",
      "  pause",
      "  exit /b",
      ")",
      'if not exist "%~dp0lamplight.cjs" (',
      "  echo   First run: downloading the scanner...",
      `  curl -L -o "%~dp0lamplight.cjs" ${cjs}`,
      "  if errorlevel 1 (",
      "    echo   Could not download the scanner. Check your internet and run this again.",
      "    pause",
      "    exit /b",
      "  )",
      ")",
      "echo   Starting Lamplight and opening your browser...",
      "echo   Keep this window open while you use it. Close it to stop watching.",
      `node "%~dp0lamplight.cjs" live --site ${site}`,
      "pause",
      "",
    ].join("\r\n");
  }
  // Mac and Linux share a bash launcher.
  return [
    "#!/bin/bash",
    'cd "$(dirname "$0")" || exit 1',
    "if ! command -v node >/dev/null 2>&1; then",
    '  echo "Lamplight needs Node.js, which is free: https://nodejs.org"',
    '  echo "Install it, then double-click this file again."',
    '  read -n 1 -s -r -p "Press any key to close."',
    "  exit 1",
    "fi",
    "if [ ! -f lamplight.cjs ]; then",
    '  echo "First run: downloading the scanner..."',
    `  curl -fsSL -o lamplight.cjs ${cjs} || { echo "Could not download the scanner. Check your internet and run this again."; read -n 1 -s -r; exit 1; }`,
    "fi",
    'echo "Starting Lamplight and opening your browser..."',
    `node lamplight.cjs live --site "${site}"`,
    "",
  ].join("\n");
}

export const guessOs = (): Os => {
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
  const [showCmd, setShowCmd] = useState(false);
  const [got, setGot] = useState<"idle" | "working" | "done" | "error">("idle");
  const [addr, setAddr] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cidr = networkFrom(addr);
  // Only name a network when you typed one; otherwise the scanner finds your own by itself.
  const netFlag = cidr ? ` --network ${cidr}` : "";
  

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
        <p className="mt-1 text-[13.5px] leading-snug text-muted">A website can't see your home network, so a tiny program runs on a computer in your house. Nothing is uploaded; it only talks to this page on your own machine.</p>
      </SubHeader>

      <div className="mt-4 flex gap-1 rounded-full bg-panel-2 p-1" role="tablist" aria-label="Your computer">
        {(Object.keys(OS_NAME) as Os[]).map((o) => (
          <button key={o} role="tab" aria-selected={os === o} onClick={() => setOs(o)} className={`flex-1 rounded-full py-1.5 text-[13.5px] font-semibold ${os === o ? "bg-ink text-bg" : "text-muted hover:text-ink"}`}>
            {OS_NAME[o]}
          </button>
        ))}
      </div>

      {/* The quickest path: paste two lines. Windows doesn't block this like a downloaded file. */}
      <div className="mt-4 rounded-2xl border border-accent/40 bg-[color-mix(in_oklab,var(--accent)_7%,transparent)] p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11.5px] font-bold text-panel">Easiest</span>
          <h3 className="font-bold">Paste two lines</h3>
        </div>
        <ol className="mt-2.5 space-y-3 text-[13.5px] text-muted">
          <li>
            <span className="font-semibold text-ink">1. Open a terminal.</span>{" "}
            {os === "windows" ? <>Press the Windows key, type <b className="text-ink">cmd</b>, press Enter.</> : os === "mac" ? "Open Terminal (Applications, then Utilities)." : null} You need{" "}
            <a className="font-semibold text-accent" href="https://nodejs.org" target="_blank" rel="noreferrer">Node.js</a> once.
          </li>
          <li>
            <span className="font-semibold text-ink">2. Get the scanner</span> (only the first time):
            <Cmd os={os}>{`${os === "windows" ? "curl.exe" : "curl"} -L -o lamplight.cjs ${RAW}`}</Cmd>
          </li>
          <li>
            <span className="font-semibold text-ink">3. Start it.</span> It finds your own network, scans it, and opens Lamplight in your browser, served from your own computer, updating live.
            <Cmd os={os}>node lamplight.cjs live</Cmd>
            <span className="mt-1 block text-[12.5px] text-faint">Want a file to keep instead? Use <code className="font-mono">node lamplight.cjs scan</code> and open the file below.</span>
          </li>
        </ol>
        <p className="mt-3 border-t border-line pt-2.5 text-[12.5px] leading-relaxed text-faint">
          Be careful pasting commands from any website. This one downloads a single open-source file from GitHub that you can{" "}
          <a className="font-semibold text-accent" href="https://github.com/Vishwanathanirv/home-network-guardian/blob/main/packages/scanner/src" target="_blank" rel="noreferrer">
            read first
          </a>
          , and runs it with Node. It never asks for a password, only talks to devices on your Wi-Fi, and sends none of your data anywhere.
        </p>
      </div>

      {/* Another way: a launcher file. Some Windows setups (Smart App Control) block it. */}
      <div className="mt-4 rounded-2xl border border-line p-4">
        <div className="flex items-center gap-2">
          <h3 className="font-bold">Or: download a launcher and double-click</h3>
        </div>
        <ol className="mt-2.5 space-y-2.5 text-[13.5px] text-muted">
          <li>
            <span className="font-semibold text-ink">1. Download one file</span> (the launcher):
            <div className="mt-1.5">
              <button
                className="btn btn-accent"
                disabled={got === "working"}
                onClick={() => {
                  setGot("working");
                  const ok = saveText(LAUNCHER[os].file, launcherText(os));
                  setGot(ok ? "done" : "error");
                }}
              >
                {got === "done" ? `✓ Saved ${LAUNCHER[os].file}` : `Download the ${OS_NAME[os] === "Linux" ? "launcher" : `${OS_NAME[os]} launcher`}`}
              </button>
              {got === "error" && <p className="mt-1.5 text-[12.5px] text-warn">Your browser blocked it. You can get the launcher and scanner from the terminal section below instead.</p>}
              {got === "done" && <p className="mt-1.5 text-[12.5px] text-faint">Saved to your Downloads. It's a tiny text file — the scanner comes down automatically the first time you run it.</p>}
            </div>
          </li>
          <li>
            <span className="font-semibold text-ink">2. Double-click {OS_NAME[os] === "Linux" ? "the launcher" : LAUNCHER[os].file}.</span>{" "}
            {os === "windows" ? 'Windows may warn about an unknown file — choose "More info", then "Run anyway".' : os === "mac" ? 'The first time, right-click it and choose "Open", then "Open" again (macOS guards downloaded files).' : "You may need to mark it executable (chmod +x) first."}
          </li>
          <li>
            <span className="font-semibold text-ink">3. That's it.</span> The first run downloads the scanner next to the launcher, finds your network, scans, and opens this site by itself. Keep the little window open while you use it; close it to stop.
          </li>
        </ol>
        <p className="mt-2.5 text-[12.5px] text-faint">It needs Node.js too. If Windows says Smart App Control blocked it, that's Windows refusing any unsigned download, not a virus. Use the two lines above instead.</p>
      </div>

      <button className="mt-4 flex w-full items-center justify-between text-[13.5px] font-semibold" onClick={() => setShowCmd(!showCmd)} aria-expanded={showCmd}>
        <span>Prefer to type commands yourself?</span>
        <span className="text-faint">{showCmd ? "Hide" : "Show"}</span>
      </button>
      {showCmd && (
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
          Usually under a minute. It finds each device, asks its name and model, reads its web page and certificate, and checks the services it answers on. It never uses or guesses a password.
          <Cmd os={os}>{cidr ? `node lamplight.cjs scan --network ${cidr}` : "node lamplight.cjs scan"}</Cmd>
          {!cidr && <p className="mt-1.5 text-[12.5px]">It picks your own network by itself. Only add --network if you typed your address above.</p>}
          {os === "windows" && <p className="mt-1.5 text-[12.5px]">If Windows asks about the firewall for Node.js, click Allow, so devices can answer.</p>}
        </Step>
        <Step n={5} title="Open the result here">
          It saves a file named like <code className="font-mono text-ink">lamplight-{new Date().toISOString().slice(0, 10)}.json</code>. Choose it below.
        </Step>
      </ol>
      )}

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
              ["Choose the file name", `node lamplight.cjs scan${netFlag} --out tonight.json`],
              ["Check only some services", `node lamplight.cjs scan${netFlag} --ports 22,23,80,443,554,5555`],
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
              <Cmd os={os}>{os === "windows" ? `schtasks /create /sc daily /st 02:00 /tn Lamplight /tr "node %USERPROFILE%\\lamplight.cjs scan${netFlag} --out %USERPROFILE%\\today.json"` : `(crontab -l; echo "0 2 * * * cd ~ && node lamplight.cjs scan${netFlag} --out today.json >/dev/null && node lamplight.cjs compare last.json today.json; mv today.json last.json") | crontab -`}</Cmd>
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
              <Cmd os={os}>{`${os === "windows" ? "" : "sudo "}nmap -sV -O -oX scan.xml ${cidr ?? "YOUR-NETWORK/24"}`}</Cmd>
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
