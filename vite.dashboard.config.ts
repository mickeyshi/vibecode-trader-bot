import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildDashboardReportIndex,
  loadIndexedDashboardReport
} from "./src/dashboard/report-index.js";

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

function backtestReportMiddleware() {
  const serveReports = async (
    request: { url?: string },
    response: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(body?: string): void;
    },
    next: () => void
  ) => {
    const path = request.url?.split("?", 1)[0];
    if (!path?.startsWith("/api/backtests")) return next();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    try {
      if (path === "/api/backtests") {
        response.end(JSON.stringify(await buildDashboardReportIndex()));
        return;
      }
      const id = path.match(/^\/api\/backtests\/([a-f0-9]{16})$/)?.[1];
      const report = id ? await loadIndexedDashboardReport(id) : undefined;
      if (!report) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "Backtest report not found." }));
        return;
      }
      response.end(JSON.stringify(report));
    } catch {
      response.statusCode = 500;
      response.end(JSON.stringify({ error: "Backtest report index failed." }));
    }
  };
  return {
    name: "backtest-report-api",
    configureServer(server: { middlewares: { use(handler: typeof serveReports): void } }) {
      server.middlewares.use(serveReports);
    },
    configurePreviewServer(server: { middlewares: { use(handler: typeof serveReports): void } }) {
      server.middlewares.use(serveReports);
    }
  };
}

function researchReportMiddleware() {
  const serveResearch = async (
    request: { url?: string },
    response: {
      statusCode: number;
      setHeader(name: string, value: string): void;
      end(body?: string): void;
    },
    next: () => void
  ) => {
    if (request.url?.split("?", 1)[0] !== "/api/research/etf-momentum") return next();
    try {
      const body = await readFile(resolve("reports/etf-momentum-research.json"), "utf8");
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  };
  return {
    name: "etf-research-report",
    configureServer(server: { middlewares: { use(handler: typeof serveResearch): void } }) {
      server.middlewares.use(serveResearch);
    },
    configurePreviewServer(server: { middlewares: { use(handler: typeof serveResearch): void } }) {
      server.middlewares.use(serveResearch);
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    liveSnapshotMiddleware(),
    backtestReportMiddleware(),
    researchReportMiddleware()
  ],
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
