import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { analyse, compare, DEMO_DETAILS, DEMO_INTERNET, DEMO_XML_TONIGHT, KIND_NAME, parseAny, parseNmap, serviceName, setOui, withDetails, type Change, type OuiTable, type Report } from "@lamplight/core";
import oui from "../../core/data/oui.json";
import { startLive } from "./live";
import { defaultGateway, interfaces, pickNetwork, scanNetwork } from "./net";

setOui(oui as OuiTable);

/** Opens a link in the computer's default browser, so no one has to copy a URL. Best effort. */
function openBrowser(url: string) {
  const [cmd, args] = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
  } catch {
    /* no browser to open; the printed link still works */
  }
}

const HELP = `Lamplight: find every device on your home network and what's risky about it.

Usage:
  lamplight networks
      List the networks this computer is on, and which one a scan would use.
  lamplight scan [--network 192.168.1.0/24] [--out scan.json]
      Scan your own network (detected automatically) and save the result.
      Open the file at the Lamplight site to see it on a floor plan.
  lamplight live [--network 192.168.1.0/24] [--every 10] [--port 47114]
      Keep watching: see devices join and leave as it happens, on the site.
      Prints a link with a private key; open it in your browser.
  lamplight demo [--out demo.json]
      Save the example home's scan, to try the site and the commands
      without scanning anything.
  lamplight report <scan>
      Print what to fix. Reads Lamplight JSON, nmap XML (-oX) or an ARP table.
  lamplight compare <older scan> <newer scan>
      Print devices that joined or left and services that opened.
      Exits with code 1 if a new device joined, so it can drive an alert.

Try it without scanning:
  lamplight demo && lamplight report lamplight-demo.json

Options:
  --network <cidr>   Network to scan (default: this computer's /24)
  --out <file>       Where to save the scan (default: lamplight-<date>.json)
  --ports <list>     Comma-separated ports instead of the default 39
  --every <minutes>  Live mode: minutes between full scans (default 10)
  --port <n>         Live mode: local port for the site to read from (default 47114)
  --site <url>       Live mode: the Lamplight site to link to
  --json             Print reports as JSON
  -h, --help         Show this help

Only scan networks you own or are allowed to test. Lamplight refuses public addresses.
`;

const SEV_ORDER = ["critical", "high", "medium", "low", "info"] as const;
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const SEV_COLOR = { critical: "1;31", high: "31", medium: "33", low: "36", info: "2" } as const;

function load(file: string) {
  return parseAny(readFileSync(file, "utf8"));
}

function printReport(r: Report) {
  const out: string[] = [`${r.devices.length} devices on ${r.scan.network ?? "the network"}, scanned ${new Date(r.scan.at).toLocaleString()}`, ""];
  for (const d of r.devices) {
    const label = [d.details?.name ?? d.hostname ?? d.vendor ?? "unnamed", d.details?.model && `(${d.details.model})`].filter(Boolean).join(" ");
    out.push(`${c("1", d.ip.padEnd(16))}${KIND_NAME[d.kind].padEnd(22)}${label}${d.worst && d.worst !== "info" ? `  ${c(SEV_COLOR[d.worst], d.worst)}` : ""}`);
  }
  const net = r.scan.internet;
  if (net) {
    const parts = [net.routerMs !== undefined && `router ${net.routerMs} ms`, net.internetMs !== undefined && `internet ${net.internetMs} ms (jitter ${net.jitterMs ?? 0} ms)`, net.dnsMs !== undefined && `name lookup ${net.dnsMs} ms`].filter(Boolean);
    out.push("", c("1", "Connection: ") + (parts.join(", ") || "no answer from the internet"));
    if (net.mappings?.length) out.push(c("33", `The router has ${net.mappings.length} door${net.mappings.length === 1 ? "" : "s"} open to the internet (UPnP):`), ...net.mappings.map((m) => `  ${m.protocol} ${m.externalPort} -> ${m.client}:${m.internalPort}${m.description ? `  "${m.description}"` : ""}`));
  }
  out.push("", r.issues.length ? c("1", "What to fix, most urgent first:") : c("32", "Nothing risky found."));
  for (const sev of SEV_ORDER) {
    for (const i of r.issues.filter((x) => x.severity === sev)) {
      const d = r.devices.find((x) => x.ip === i.ip);
      out.push("", `${c(SEV_COLOR[sev], sev.toUpperCase())}  ${c("1", i.title)}${d ? `  (${d.hostname ?? d.ip})` : ""}`, `  ${i.why}`, ...i.steps.map((s) => `  - ${s}`));
    }
  }
  return out.join("\n") + "\n";
}

const describe = (ch: Change) => {
  const d = ch.device;
  const who = `${d.hostname ?? d.vendor ?? "Unnamed device"} (${d.ip}${d.mac ? `, ${d.mac}` : ""})`;
  if (ch.type === "joined") return `${c("33", "New device:")} ${who}`;
  if (ch.type === "left") return `Gone: ${who}`;
  if (ch.type === "moved") return `Changed address: ${who}, was ${ch.from}`;
  const names = ch.ports.map((p) => serviceName(d.ports.find((x) => x.port === p) ?? { port: p, proto: "tcp" })).join(", ");
  return ch.type === "opened" ? `${c("33", "Newly open:")} ${names} on ${who}` : `Now closed: ${names} on ${who}`;
};

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { network: { type: "string" }, out: { type: "string" }, ports: { type: "string" }, json: { type: "boolean" }, every: { type: "string" }, port: { type: "string" }, site: { type: "string" }, open: { type: "boolean" }, "no-open": { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  const [cmd, ...files] = positionals;
  if (values.help || !cmd) {
    process.stdout.write(HELP);
    return cmd || values.help ? 0 : 2;
  }
  if (cmd === "networks") {
    const gw = await defaultGateway();
    const list = interfaces(gw);
    const pick = pickNetwork(list);
    if (!list.length) process.stdout.write("No private networks found. Are you connected to Wi-Fi?\n");
    for (const i of list) process.stdout.write(`${i === pick ? c("32", "→ ") : "  "}${i.cidr.padEnd(18)}${i.name}${i.address ? ` (this computer: ${i.address})` : ""}${i.gateway ? c("32", "  has the router") : ""}${i.virtual ? c("2", "  virtual, skipped") : ""}\n`);
    if (pick) process.stdout.write(`\nA scan would use ${pick.cidr}. To pick another: lamplight scan --network <network>\n`);
    return 0;
  }
  if (cmd === "live") {
    const gw = await defaultGateway();
    const list = interfaces(gw);
    const local = pickNetwork(list);
    const cidr = values.network ?? local?.cidr;
    if (!cidr) throw new Error("Couldn't find this computer's network. Run lamplight networks, then pass --network with your network, like 192.168.1.0/24.");
    const port = Number(values.port ?? 47114);
    const every = Math.max(2, Number(values.every ?? 10));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be a number from 1024 to 65535.");
    const site = (values.site ?? "https://home-network-guardian.vercel.app").replace(/\/$/, "");
    const live = startLive({ cidr, self: values.network ? list.find((i) => i.cidr === values.network)?.address : local?.address, port, every, log: (l) => process.stdout.write(`${l}\n`) });
    await live.ready.catch((e: NodeJS.ErrnoException) => {
      throw new Error(e.code === "EADDRINUSE" ? `Port ${port} is busy. Is live mode already running? Or pick another with --port.` : e.message);
    });
    process.stdout.write(`\n${c("1", "Lamplight is watching")} ${cidr}. Full scan every ${every} minutes, a quick check every 15 seconds.\n\nOpen this link to see it live (keep it private, it has your key):\n\n  ${c("36", `${site}/?live=${port}&key=${live.key}`)}\n\nLive mode shows everything on the site as it happens; it does not save a file. For a file to open later, use "${c("1", "node lamplight.cjs scan")}" instead.\nThe first scan takes about a minute. Press Ctrl+C to stop.\n\n`);
    const link = `${site}/?live=${port}&key=${live.key}`;
    if (!values["no-open"]) {
      process.stderr.write("Opening it in your browser…\n");
      setTimeout(() => openBrowser(link), 500);
    }
    await new Promise<void>((resolve) => process.once("SIGINT", resolve));
    live.stop();
    process.stdout.write("\nStopped.\n");
    return 0;
  }
  if (cmd === "demo") {
    const scan = { ...withDetails(parseNmap(DEMO_XML_TONIGHT), DEMO_DETAILS), internet: DEMO_INTERNET, gateway: "192.168.1.1" };
    const out = values.out ?? "lamplight-demo.json";
    writeFileSync(out, JSON.stringify({ ...scan, source: "lamplight" }, null, 2));
    process.stderr.write(`Saved the example home to ${out}. Open it at the Lamplight site, or run: lamplight report ${out}\n\n`);
    process.stdout.write(printReport(analyse(scan)));
    return 0;
  }
  if (cmd === "scan") {
    const gw = await defaultGateway();
    const local = pickNetwork(interfaces(gw));
    const cidr = values.network ?? local?.cidr;
    if (!cidr) throw new Error("Couldn't find this computer's network. Run lamplight networks, then pass --network with your network, like 192.168.1.0/24.");
    const self = values.network ? interfaces(gw).find((i) => i.cidr === values.network)?.address : local?.address;
    const ports = values.ports?.split(",").map((p) => {
      const n = Number(p.trim());
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`"${p}" isn't a port number.`);
      return n;
    });
    if (values.network && !self) {
      process.stderr.write(c("33", `Heads up: ${cidr} isn't a network this computer is joined to${local ? ` (yours is ${local.cidr})` : ""}.\nDevices there sit behind another router, so they can't tell us their names. For real names, run "node lamplight.cjs scan" with no --network.\n\n`));
    }
    process.stderr.write(`Scanning ${cidr}${local && !values.network ? ` on ${local.name}` : ""}. This takes about a minute…\n`);
    const scan = await scanNetwork({ cidr, self, ports, onProgress: (d, t) => process.stderr.write(`\r\x1b[2K${Math.round((d / t) * 100)}% `), onStep: (t) => process.stderr.write(`\r\x1b[2K${t}`) });
    const out = values.out ?? `lamplight-${scan.at.slice(0, 10)}.json`;
    writeFileSync(out, JSON.stringify(scan, null, 2));
    const full = resolve(out);
    process.stderr.write(`\r\x1b[2K${c("32", `Found ${scan.devices.length} devices.`)}\nSaved the file here:\n  ${c("36", full)}\n\nThat's the folder your terminal is in — not your Downloads folder.\nTo see it as the atom map, open ${c("36", "home-network-guardian.vercel.app")}, click "Scan your home", and pick that file.\n\n`);
    process.stdout.write(values.json ? JSON.stringify(analyse(scan), null, 2) : printReport(analyse(scan)));
    return 0;
  }
  if (cmd === "report") {
    if (files.length !== 1) throw new Error("Usage: lamplight report <scan file>");
    const r = analyse(load(files[0]));
    process.stdout.write(values.json ? JSON.stringify(r, null, 2) + "\n" : printReport(r));
    return 0;
  }
  if (cmd === "compare") {
    if (files.length !== 2) throw new Error("Usage: lamplight compare <older scan> <newer scan>");
    const changes = compare(load(files[0]), load(files[1]));
    if (values.json) process.stdout.write(JSON.stringify(changes, null, 2) + "\n");
    else process.stdout.write(changes.length ? changes.map(describe).join("\n") + "\n" : "No changes.\n");
    return changes.some((x) => x.type === "joined") ? 1 : 0;
  }
  throw new Error(`Unknown command "${cmd}". Run lamplight --help.`);
}

main().then(
  (code) => (process.exitCode = code),
  (e: Error) => {
    process.stderr.write(`lamplight: ${e.message}\n`);
    process.exitCode = 2;
  },
);
