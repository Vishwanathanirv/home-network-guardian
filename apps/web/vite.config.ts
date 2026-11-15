import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@lamplight/core": path.resolve(__dirname, "../../packages/core/src/index.ts") } },
  server: { port: 5173 },
  build: { outDir: "dist", sourcemap: false },
});
