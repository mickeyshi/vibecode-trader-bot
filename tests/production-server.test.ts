import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDashboardServer,
  loadDashboardServerConfig,
  type DashboardServerConfig
} from "../src/dashboard/production-server.js";

const servers: ReturnType<typeof createDashboardServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
  );
});

describe("production dashboard server", () => {
  it("refuses a remote bind until authentication is configured", () => {
    expect(() => loadDashboardServerConfig({ DASHBOARD_HOST: "0.0.0.0" })).toThrow(
      "Remote dashboard binding is disabled"
    );
  });

  it("serves health, the PWA shell, and a no-store snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-server-"));
    const staticRoot = join(root, "static");
    const reportsRoot = join(root, "reports");
    const historyDir = join(reportsRoot, "live-ops-history");
    await mkdir(staticRoot);
    await mkdir(reportsRoot);
    await mkdir(historyDir);
    await writeFile(join(staticRoot, "index.html"), "<h1>Trading</h1>");
    await writeFile(join(reportsRoot, "live.json"), '{"mode":"paper"}');
    await writeFile(join(reportsRoot, "research.json"), '{"researchOnly":true}');
    await writeFile(
      join(historyDir, "2026-09-20T12-00-00.000Z.json"),
      JSON.stringify({
        updatedAt: "2026-09-20T12:00:00Z",
        headlineStatus: "ready",
        executable: true,
        account: {
          equity: 100001,
          dayRealizedPnl: 1,
          dayUnrealizedPnl: 0,
          grossExposure: 25
        },
        positions: [{}],
        orders: [],
        paperCycles: [{}],
        paperRun: { dryRun: true, executionCount: 0 }
      })
    );
    const baseUrl = await listen({
      host: "127.0.0.1",
      port: 0,
      staticRoot,
      reportsRoot,
      historyDir,
      snapshotPath: join(reportsRoot, "live.json"),
      researchPath: join(reportsRoot, "research.json")
    });

    const live = await fetch(`${baseUrl}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "live" });

    const ready = await fetch(`${baseUrl}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ status: "ready" });

    const shell = await fetch(`${baseUrl}/portfolio`);
    expect(shell.status).toBe(200);
    expect(await shell.text()).toContain("Trading");
    expect(shell.headers.get("x-frame-options")).toBe("DENY");

    const snapshot = await fetch(`${baseUrl}/live-ops-snapshot.json`);
    expect(snapshot.status).toBe(200);
    expect(snapshot.headers.get("cache-control")).toBe("no-store");
    expect(await snapshot.json()).toEqual({ mode: "paper" });

    const research = await fetch(`${baseUrl}/api/research/etf-momentum`);
    expect(research.status).toBe(200);
    expect(research.headers.get("cache-control")).toBe("no-store");
    expect(await research.json()).toEqual({ researchOnly: true });

    const history = await fetch(`${baseUrl}/api/operations/history`);
    expect(history.status).toBe(200);
    expect(history.headers.get("cache-control")).toBe("no-store");
    expect(await history.json()).toMatchObject({
      totalAvailable: 1,
      invalidFileCount: 0,
      entries: [{ equity: 100001, positionCount: 1, decisionCount: 1, dryRun: true }]
    });
  });

  it("reports not-ready when the PWA build is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "dashboard-server-"));
    const reportsRoot = join(root, "reports");
    await mkdir(reportsRoot);
    const baseUrl = await listen({
      host: "127.0.0.1",
      port: 0,
      staticRoot: join(root, "missing"),
      reportsRoot,
      historyDir: join(reportsRoot, "live-ops-history"),
      snapshotPath: join(reportsRoot, "missing.json"),
      researchPath: join(reportsRoot, "missing-research.json")
    });
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(503);
  });
});

async function listen(config: DashboardServerConfig): Promise<string> {
  const server = createDashboardServer(config);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
  const address = server.address() as AddressInfo;
  return `http://${address.address}:${address.port}`;
}
