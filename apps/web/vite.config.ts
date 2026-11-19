import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

// The preview server sends the same security headers as production (vercel.json), so the
// end-to-end tests run under the real Content-Security-Policy.
type VercelHeaders = { headers: { source: string; headers: { key: string; value: string }[] }[] };
const vercel = JSON.parse(readFileSync(path.resolve(__dirname, "../../vercel.json"), "utf8")) as VercelHeaders;
const security = Object.fromEntries(vercel.headers.find((h) => h.source === "/(.*)")!.headers.map((h) => [h.key, h.value]));

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@lamplight/core": path.resolve(__dirname, "../../packages/core/src/index.ts") } },
  server: { port: 5173 },
  preview: { headers: security },
  build: { outDir: "dist", sourcemap: false },
});
