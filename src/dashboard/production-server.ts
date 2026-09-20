import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { buildDashboardReportIndex, loadIndexedDashboardReport } from "./report-index.js";

export interface DashboardServerConfig {
  host: string;
  port: number;
  staticRoot: string;
  reportsRoot: string;
  snapshotPath: string;
  researchPath: string;
}

export function loadDashboardServerConfig(
  environment: NodeJS.ProcessEnv = process.env
): DashboardServerConfig {
  const host = environment.DASHBOARD_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackHost(host)) {
    throw new Error(
      "Remote dashboard binding is disabled until an authentication boundary is configured."
    );
  }
  const port = parsePort(environment.PORT ?? environment.DASHBOARD_PORT ?? "4173");
  return {
    host,
    port,
    staticRoot: resolve(environment.DASHBOARD_STATIC_ROOT ?? "dist-dashboard"),
    reportsRoot: resolve(environment.DASHBOARD_REPORTS_ROOT ?? "reports"),
    snapshotPath: resolve(environment.DASHBOARD_SNAPSHOT_PATH ?? "reports/live-ops-snapshot.json"),
    researchPath: resolve(
      environment.DASHBOARD_RESEARCH_PATH ?? "reports/etf-momentum-research.json"
    )
  };
}

export function createDashboardServer(config: DashboardServerConfig): Server {
  return createServer((request, response) => {
    void routeRequest(request, response, config).catch(() => {
      if (!response.headersSent) json(response, 500, { error: "Dashboard request failed." });
      else response.end();
    });
  });
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: DashboardServerConfig
): Promise<void> {
  securityHeaders(response);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    json(response, 405, { error: "Method not allowed." }, request.method === "HEAD");
    return;
  }

  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const headOnly = request.method === "HEAD";
  if (path === "/health/live") {
    json(response, 200, { status: "live" }, headOnly);
    return;
  }
  if (path === "/health/ready") {
    try {
      await access(resolve(config.staticRoot, "index.html"), constants.R_OK);
      await access(config.reportsRoot, constants.R_OK | constants.W_OK);
      json(response, 200, { status: "ready" }, headOnly);
    } catch {
      json(response, 503, { status: "not-ready" }, headOnly);
    }
    return;
  }
  if (path === "/live-ops-snapshot.json") {
    await serveJsonFile(response, config.snapshotPath, headOnly);
    return;
  }
  if (path === "/api/research/etf-momentum") {
    await serveJsonFile(response, config.researchPath, headOnly);
    return;
  }
  if (path === "/api/backtests") {
    json(response, 200, await buildDashboardReportIndex(config.reportsRoot), headOnly);
    return;
  }
  const reportId = path.match(/^\/api\/backtests\/([a-f0-9]{16})$/)?.[1];
  if (reportId) {
    const report = await loadIndexedDashboardReport(reportId, config.reportsRoot);
    json(response, report ? 200 : 404, report ?? { error: "Backtest report not found." }, headOnly);
    return;
  }
  if (path.startsWith("/api/")) {
    json(response, 404, { error: "API route not found." }, headOnly);
    return;
  }
  await serveStatic(response, path, config.staticRoot, headOnly);
}

async function serveJsonFile(
  response: ServerResponse,
  path: string,
  headOnly: boolean
): Promise<void> {
  try {
    const body = await readFile(path);
    response.statusCode = 200;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(headOnly ? undefined : body);
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      json(response, 404, { error: "Live operations snapshot not found." }, headOnly);
      return;
    }
    throw error;
  }
}

async function serveStatic(
  response: ServerResponse,
  requestPath: string,
  staticRoot: string,
  headOnly: boolean
): Promise<void> {
  const root = resolve(staticRoot);
  const decodedPath = decodeURIComponent(requestPath);
  const candidate = resolve(root, `.${decodedPath}`);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    json(response, 404, { error: "Not found." }, headOnly);
    return;
  }
  const requestedFile = decodedPath === "/" ? resolve(root, "index.html") : candidate;
  try {
    const body = await readFile(requestedFile);
    response.statusCode = 200;
    response.setHeader("Content-Type", contentType(requestedFile));
    response.setHeader(
      "Cache-Control",
      requestedFile.endsWith("index.html") || requestedFile.endsWith("sw.js")
        ? "no-cache"
        : "public, max-age=31536000, immutable"
    );
    response.end(headOnly ? undefined : body);
  } catch (error: unknown) {
    if (!isNodeError(error) || (error.code !== "ENOENT" && error.code !== "EISDIR")) throw error;
    try {
      const body = await readFile(resolve(root, "index.html"));
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache");
      response.end(headOnly ? undefined : body);
    } catch {
      json(response, 404, { error: "Dashboard build not found." }, headOnly);
    }
  }
}

function securityHeaders(response: ServerResponse): void {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  );
}

function json(response: ServerResponse, status: number, value: unknown, headOnly = false): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(headOnly ? undefined : JSON.stringify(value));
}

function contentType(path: string): string {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".webmanifest": "application/manifest+json; charset=utf-8"
    }[extname(path).toLowerCase()] ?? "application/octet-stream"
  );
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Dashboard port must be an integer from 0 through 65535.");
  }
  return port;
}

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
