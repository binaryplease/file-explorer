import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "path";

// The one subset the explorer is guaranteed to need on first paint: mono is the
// app's primary face (theme.css, --font-mono) and the tree is ASCII, so the
// latin cut is on the critical path while the other six are not.
const MONO_LATIN_SUBSET_PATTERN = /fira-code-latin-wght-normal-[^/]*\.woff2$/;

// Preload that subset from the document head.
//
// Without this the browser cannot discover the font until it has fetched and
// parsed the render-blocking stylesheet the @font-face lives in, so with
// `font-display: swap` the whole tree paints in the system fallback and then
// reflows to Fira Code — a flash across every row, not one panel, because mono
// is the primary face. The preload starts that fetch in parallel with the CSS
// instead of after it (AGENTS.md responsiveness principle).
//
// Build-only: the hashed filename is knowable only from the bundle, and the dev
// server serves the unhashed file off the local filesystem where the swap is not
// felt. `crossorigin` is not optional — fonts are always fetched in CORS mode,
// and a preload without it is a second, wasted request rather than a warm cache.
function preloadMonoLatinSubset(): Plugin {
  // Captured from the resolved config rather than read off `context.server`,
  // which does not exist during a build.
  let publicBasePath = "/";
  return {
    name: "preload-mono-latin-subset",
    apply: "build",
    configResolved(resolvedConfig) {
      publicBasePath = resolvedConfig.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const subsetFileName = Object.keys(context.bundle ?? {}).find((fileName) =>
          MONO_LATIN_SUBSET_PATTERN.test(fileName),
        );
        // Fail loud rather than silently shipping the reflow back: if the font
        // package is swapped or its subset renamed, this stops the build instead
        // of quietly dropping the preload.
        if (subsetFileName === undefined) {
          throw new Error(
            "preload-mono-latin-subset: no emitted asset matched " +
              `${MONO_LATIN_SUBSET_PATTERN}. The mono font's latin subset moved or its ` +
              "import was dropped — update the pattern or remove this plugin.",
          );
        }
        return [
          {
            tag: "link",
            attrs: {
              rel: "preload",
              as: "font",
              type: "font/woff2",
              href: `${publicBasePath}${subsetFileName}`,
              crossorigin: "",
            },
            injectTo: "head",
          },
        ];
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadMonoLatinSubset()],
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
    // `fail-loud-ports`: never migrate to another port at bind time. Any
    // reassignment is decided up front by the pre-dev setup, not silently here.
    strictPort: true,
    proxy: {
      // Dev: Vite serves the client, Elysia serves the API on :3000.
      "^/api/.*": {
        // Literal IPv4, not `localhost`: on a dual-stack box `localhost`
        // resolves `::1` first (verbatim DNS order, Node/Bun ≥17), but the
        // Elysia server binds 127.0.0.1 — so a name-based target would try the
        // wrong family first. dev.ts overrides this with VITE_API_TARGET anyway;
        // this fallback only fires for a bare `dev:client`.
        target: process.env.VITE_API_TARGET || "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
