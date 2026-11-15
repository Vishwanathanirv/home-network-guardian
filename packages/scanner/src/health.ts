import { promises as dns } from "node:dns";
import net from "node:net";
import type { Internet } from "@lamplight/core";

/** Time to open a TCP connection, in milliseconds; a refusal still counts as an answer. */
export function connectTime(host: string, port: number, timeout = 2000): Promise<number | undefined> {
  const start = performance.now();
  return new Promise((resolve) => {
    const s = net.connect({ host, port });
    const end = (ok: boolean) => {
      s.destroy();
      resolve(ok ? Math.round((performance.now() - start) * 10) / 10 : undefined);
    };
    s.setTimeout(timeout, () => end(false));
    s.on("connect", () => end(true));
    s.on("error", (e: NodeJS.ErrnoException) => end(e.code === "ECONNREFUSED"));
  });
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/**
 * How the connection looks from inside: how fast the router and the internet answer, how steady
 * that is, how long a name lookup takes, and whether the router's DNS invents answers for names
 * that don't exist (some ISPs do this to show ads on typos; it also breaks some security tools).
 */
export async function health(gateway?: string, routerPort = 80): Promise<Internet> {
  const out: Internet = {};
  if (gateway) {
    const r: number[] = [];
    for (let i = 0; i < 4; i++) {
      const t = (await connectTime(gateway, routerPort)) ?? (await connectTime(gateway, 53));
      if (t !== undefined) r.push(t);
    }
    if (r.length) out.routerMs = median(r);
  }
  const samples: number[] = [];
  for (let i = 0; i < 6; i++) {
    const t = await connectTime(i % 2 ? "1.1.1.1" : "8.8.8.8", 443);
    if (t !== undefined) samples.push(t);
  }
  if (samples.length) {
    out.internetMs = median(samples);
    // Jitter: the average change between one answer and the next.
    if (samples.length > 1) out.jitterMs = Math.round((samples.slice(1).reduce((n, t, i) => n + Math.abs(t - samples[i]), 0) / (samples.length - 1)) * 10) / 10;
  }
  const t = performance.now();
  try {
    await Promise.race([dns.lookup(`www.wikipedia.org`), new Promise((_, no) => setTimeout(no, 3000))]);
    out.dnsMs = Math.round(performance.now() - t);
  } catch {
    /* no DNS: leave it out */
  }
  if (gateway) {
    const res = new dns.Resolver({ timeout: 2000, tries: 1 });
    res.setServers([gateway]);
    const name = `lamplight-check-${Math.random().toString(36).slice(2, 12)}.com`;
    out.nxdomainHijack = await res.resolve4(name).then(
      (a) => a.length > 0,
      (e: NodeJS.ErrnoException) => (e.code === "ENOTFOUND" || e.code === "ENODATA" ? false : undefined),
    );
    if (out.nxdomainHijack === undefined) delete out.nxdomainHijack;
  }
  return out;
}
