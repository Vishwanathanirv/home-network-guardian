import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The Lamplight website, built into the scanner itself, so it runs entirely on your own computer:
 * no outside site, no internet needed, nothing to trust but the one file you're running.
 * Each file is stored gzipped; browsers unpack it themselves.
 */
export type SiteFiles = Map<string, { type: string; body: Buffer }>;

export function siteFiles(raw: Record<string, [string, string]>): SiteFiles {
  return new Map(Object.entries(raw).map(([path, [type, b64]]) => [path, { type, body: Buffer.from(b64, "base64") }]));
}

/** The same Content-Security-Policy the hosted site sends (vercel.json): only this app's own code runs. */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** Serves one file of the built-in site. Any page path without a file falls back to the app. */
export function serveSite(files: SiteFiles, req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const want = decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = files.get(want) ?? (/\.[a-z0-9]+$/i.test(want) ? undefined : files.get("index.html"));
  if (!file) return false;
  res.writeHead(200, {
    "content-type": file.type,
    "content-encoding": "gzip",
    "content-length": file.body.length,
    "cache-control": want.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy": CSP,
    "x-frame-options": "DENY",
  });
  res.end(req.method === "HEAD" ? undefined : file.body);
  return true;
}

/**
 * Only answer when the browser is talking to this computer by its own name. That stops a
 * trick called DNS rebinding, where a website points its own address at 127.0.0.1 to read local pages.
 */
export function localHost(req: IncomingMessage, port: number) {
  const host = (req.headers.host ?? "").toLowerCase();
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}
