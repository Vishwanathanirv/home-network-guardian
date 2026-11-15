/**
 * Turns the IEEE OUI registry (from the oui-data package) into a compact vendor table:
 * short, readable vendor names and a map from the first three bytes of a MAC address.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const raw = JSON.parse(readFileSync(require.resolve("oui-data"), "utf8")) as Record<string, string>;

const SUFFIX = /[\s,.]*(co\.?,?\s*ltd\.?|company|corporation|corp\.?|inc\.?|incorporated|limited|ltd\.?|llc|l\.l\.c\.|gmbh(\s*&\s*co\.?\s*kg)?|s\.?a\.?|s\.?p\.?a\.?|ag|b\.?v\.?|n\.?v\.?|plc|pty|pte|oy|ab|as|a\/s|kg|sas|s\.r\.l\.|srl|technologies|technology|tech|electronics|electronic|international|holdings?|group|manufacturing|industrial|systems?|communications?|networks?)$/i;

function clean(name: string): string {
  let n = name.split("\n")[0].trim().replace(/，/g, ",").replace(/\s+/g, " ");
  for (let i = 0; i < 6; i++) {
    const next = n.replace(SUFFIX, "").trim();
    if (next === n || next.length < 2) break;
    n = next;
  }
  if (n === n.toUpperCase()) n = n.replace(/[A-Z][A-Z']+/g, (w) => (w.length <= 4 ? w : w[0] + w.slice(1).toLowerCase()));
  return n.replace(/[,.\s]+$/, "");
}

const vendors: string[] = [];
const index = new Map<string, number>();
const prefixes: Record<string, number> = {};
for (const [prefix, name] of Object.entries(raw)) {
  if (!/^[0-9A-F]{6}$/i.test(prefix)) continue;
  const v = clean(name);
  if (!v) continue;
  let i = index.get(v);
  if (i === undefined) {
    i = vendors.push(v) - 1;
    index.set(v, i);
  }
  prefixes[prefix.toUpperCase()] = i;
}
const out = path.join(import.meta.dirname, "../packages/core/data/oui.json");
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ source: "IEEE OUI registry via the oui-data package (BSD-2-Clause)", vendors, prefixes }));
console.log(`${Object.keys(prefixes).length} prefixes, ${vendors.length} vendors -> ${out}`);
