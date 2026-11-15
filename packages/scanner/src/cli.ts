import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { analyse, compare, KIND_NAME, parseAny, serviceName, setOui, type Change, type OuiTable, type Report } from "@lamplight/core";
import oui from "../../core/data/oui.json";
import { localNetwork, scanNetwork } from "./net";

setOui(oui as OuiTable);

const HELP = `Lamplight: find every device on your home network and what's risky about it.

Usage:
  lamplight scan [--network 192.168.1.0/24] [--out scan.json]
      Scan your own network (detected automatically) and save the result.
      Open the file at the Lamplight site to see it on a floor plan.
  lamplight report <scan>
      Print what to fix. Reads Lamplight JSON, nmap XML (-oX) or an ARP table.
  lamplight compare <older scan> <newer scan>
      Print devices that joined or left and services that opened.
      Exits with code 1 if a new device joined, so it can drive an alert.

Options:
  --network <cidr>   Network to scan (default: this computer's /24)
  --out <file>       Where to save the scan (default: lamplight-<date>.json)
  --ports <list>     Comma-separated ports instead of the default 39
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
    const label = d.hostname ?? d.vendor ?? "unnamed";
    out.push(`${c("1", d.ip.padEnd(16))}${KIND_NAME[d.kind].padEnd(22)}${label}${d.worst && d.worst !== "info" ? `  ${c(SEV_COLOR[d.worst], d.worst)}` : ""}`);
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
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { network: { type: "string" }, out: { type: "string" }, ports: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" } } });
  const [cmd, ...files] = positionals;
  if (values.help || !cmd) {
    process.stdout.write(HELP);
    return cmd || values.help ? 0 : 2;
  }
  if (cmd === "scan") {
    const local = localNetwork();
    const cidr = values.network ?? local?.cidr;
    if (!cidr) throw new Error("Couldn't find this computer's network. Pass --network 192.168.1.0/24.");
    const ports = values.ports?.split(",").map((p) => {
      const n = Number(p.trim());
      if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`"${p}" isn't a port number.`);
      return n;
    });
    process.stderr.write(`Scanning ${cidr}. This takes about a minute…\n`);
    const scan = await scanNetwork({ cidr, ports, onProgress: (d, t) => process.stderr.write(`\r${Math.round((d / t) * 100)}%`) });
    const out = values.out ?? `lamplight-${scan.at.slice(0, 10)}.json`;
    writeFileSync(out, JSON.stringify(scan, null, 2));
    process.stderr.write(`\rFound ${scan.devices.length} devices. Saved to ${out}.\n\n`);
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
