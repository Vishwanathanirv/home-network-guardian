/* global console */
// Bundles the scanner into one file and builds the website into it, so `lamplight live`
// serves the whole app from your own computer.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const root = resolve(pkg, "../..");
const dist = join(root, "apps/web/dist");
// The scanner, its checksum and its launchers live in the site's folder too; they don't belong
// inside the scanner (embedding the checksum would make every build depend on the one before it).
const SKIP = /^(lamplight\.cjs(\.sha256)?|lamplight-[\w-]+\.(cmd|command))$/;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};
/**
 * Gzip with a fixed header, so the scanner is byte-identical whichever OS builds it: zlib writes the
 * building OS into header byte 9 (0x0a on Windows, 0x03 on Unix), which CI's "committed scanner
 * matches the source" check would otherwise trip over.
 */
const gzip = (buf) => {
  const z = gzipSync(buf, { level: 9 });
  z[9] = 3;
  return z;
};
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

const files = {};
if (existsSync(join(dist, "index.html"))) {
  for (const f of walk(dist)) {
    const rel = relative(dist, f).split(sep).join("/");
    if (SKIP.test(rel)) continue;
    files[rel] = [TYPES[extname(f)] ?? "application/octet-stream", gzip(readFileSync(f)).toString("base64")];
  }
} else console.warn("No built website found (run the web build first); the scanner will point to the hosted site instead.");

await build({
  entryPoints: [join(pkg, "src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  outfile: join(pkg, "dist/lamplight.cjs"),
  alias: { "@lamplight/core": join(root, "packages/core/src/index.ts") },
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "warning",
  plugins: [
    {
      name: "site",
      setup(b) {
        b.onResolve({ filter: /^lamplight:ui$/ }, () => ({ path: "ui", namespace: "site" }));
        b.onLoad({ filter: /.*/, namespace: "site" }, () => ({ contents: `export const UI = ${JSON.stringify(files)};`, loader: "js" }));
      },
    },
  ],
});

mkdirSync(join(root, "scanner"), { recursive: true });
copyFileSync(join(pkg, "dist/lamplight.cjs"), join(root, "scanner/lamplight.cjs"));
// copyFileSync keeps the source's mode; the committed scanner must stay executable (and match git exactly).
chmodSync(join(root, "scanner/lamplight.cjs"), 0o755);
// The checksum the site shows next to the download command, in `sha256sum -c` format.
const sha = createHash("sha256").update(readFileSync(join(root, "scanner/lamplight.cjs"))).digest("hex");
writeFileSync(join(root, "scanner/lamplight.cjs.sha256"), `${sha}  lamplight.cjs
`);
for (const f of ["lamplight.cjs", "lamplight.cjs.sha256", "lamplight-windows.cmd", "lamplight-mac.command"])
  if (existsSync(join(root, "scanner", f))) copyFileSync(join(root, "scanner", f), join(root, "apps/web/public", f));
const kb = Math.round(statSync(join(pkg, "dist/lamplight.cjs")).size / 1024);
console.log(`Built the scanner (${kb} KB) with ${Object.keys(files).length} website files inside. SHA-256 ${sha}`);
