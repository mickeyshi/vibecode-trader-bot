import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function liveSnapshotMiddleware() {
  const serveSnapshot = async (
    request: { url?: string },
    response: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(body?: string): void;
    },
    next: () => void
  ) => {
    if (request.url?.split("?", 1)[0] !== "/live-ops-snapshot.json") return next();
    try {
      const body = await readFile(resolve("reports/live-ops-snapshot.json"), "utf8");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  };
  return {
    name: "live-operations-snapshot",
    configureServer(server: { middlewares: { use(handler: typeof serveSnapshot): void } }) {
      server.middlewares.use(serveSnapshot);
    },
    configurePreviewServer(server: { middlewares: { use(handler: typeof serveSnapshot): void } }) {
      server.middlewares.use(serveSnapshot);
    }
  };
}

export default defineConfig({
  plugins: [react(), liveSnapshotMiddleware()],
  root: "src/dashboard/app",
  publicDir: "public",
  build: {
    outDir: "../../../dist-dashboard",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
