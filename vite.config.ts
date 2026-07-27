import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: "src",
  publicDir: resolve(__dirname, "public"),
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    // Bind the exact host scripts/dev-ports.ts probed (HOST, pinned into the env
    // alongside VITE_PORT). Without this Vite defaults to `localhost`, which on a
    // dual-stack box resolves to IPv6 `::1` — a different address family than the
    // probe's `127.0.0.1`. A stale listener on `::1:5173` is then invisible to
    // the probe (which reports 5173 free and never reassigns) yet still collides
    // when Vite binds it. Binding the probed host keeps verdict and bind coherent.
    host: process.env.HOST || "127.0.0.1",
    // Ports are resolved before startup by scripts/dev-ports.ts, which pins the
    // result into VITE_PORT / VITE_API_TARGET. Absent that, the canonical ports
    // apply.
    port: Number(process.env.VITE_PORT) || 5173,
    // ADR-0018: never migrate to another port at bind time. Any reassignment is
    // decided up front by the pre-dev setup, not silently here.
    strictPort: true,
    proxy: {
      // Dev: Vite serves the client, Elysia serves the API on :3000.
      "^/api/.*": {
        target: process.env.VITE_API_TARGET || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
