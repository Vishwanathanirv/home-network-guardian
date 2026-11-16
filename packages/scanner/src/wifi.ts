import { execFile } from "node:child_process";

/*
 * Which Wi-Fi this computer is on and how it's locked, asked of the computer itself
 * (it already knows; nothing is sent to the router). Undefined on a wired connection.
 */
export type Wifi = { ssid?: string; security: string };

/** Windows: `netsh wlan show interfaces`. */
export function parseNetsh(out: string): Wifi | undefined {
  if (!/State\s*:\s*connected/i.test(out)) return undefined;
  const auth = out.match(/^\s*Authentication\s*:\s*(.+)$/im)?.[1]?.trim();
  const ssid = out.match(/^\s*SSID\s*:\s*(.+)$/im)?.[1]?.trim();
  return auth ? { ssid, security: auth } : undefined;
}

/** macOS: the "Current Network Information" part of `system_profiler SPAirPortDataType`. */
export function parseAirport(out: string): Wifi | undefined {
  const cur = out.split(/Current Network Information:/i)[1];
  if (!cur) return undefined;
  const ssid = cur.match(/^\s*(.+?):\s*$/m)?.[1]?.trim();
  const security = cur.match(/^\s*Security:\s*(.+)$/m)?.[1]?.trim();
  return security ? { ssid, security } : undefined;
}

/** Linux: `nmcli -t -f ACTIVE,SSID,SECURITY dev wifi`. */
export function parseNmcli(out: string): Wifi | undefined {
  const line = out.split("\n").find((l) => l.startsWith("yes:"));
  if (!line) return undefined;
  const [, ssid, security] = line.split(":");
  return { ssid: ssid || undefined, security: security?.trim() || "Open" };
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((done) => execFile(cmd, args, { timeout: 6000, windowsHide: true }, (_e, out) => done(String(out ?? ""))));

export async function wifiNow(): Promise<Wifi | undefined> {
  try {
    if (process.platform === "win32") return parseNetsh(await run("netsh", ["wlan", "show", "interfaces"]));
    if (process.platform === "darwin") return parseAirport(await run("system_profiler", ["SPAirPortDataType"]));
    return parseNmcli(await run("nmcli", ["-t", "-f", "ACTIVE,SSID,SECURITY", "dev", "wifi"]));
  } catch {
    return undefined;
  }
}
