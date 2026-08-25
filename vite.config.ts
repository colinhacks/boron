import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { PreviewServer, ViteDevServer } from "vite";
import { defineConfig, type Plugin } from "vitest/config";

/**
 * `/about` is `about.html`. Vercel serves it at the clean path (`cleanUrls` in
 * vercel.json); this does the same for the dev and preview servers, so the link
 * in the header works in all three.
 */
function cleanUrls(): Plugin {
  const rewrite = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((req, _res, next) => {
      if (req.url === "/about") req.url = "/about.html";
      next();
    });
  };
  return { name: "boron:clean-urls", configureServer: rewrite, configurePreviewServer: rewrite };
}

export default defineConfig({
  plugins: [react(), cleanUrls()],
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        about: fileURLToPath(new URL("./about.html", import.meta.url)),
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
