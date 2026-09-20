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
    await mkdir(staticRoot);
    await mkdir(reportsRoot);
    await writeFile(join(staticRoot, "index.html"), "<h1>Trading</h1>");
    await writeFile(join(reportsRoot, "live.json"), '{"mode":"paper"}');
    const baseUrl = await listen({
      host: "127.0.0.1",
      port: 0,
      staticRoot,
      reportsRoot,
      snapshotPath: join(reportsRoot, "live.json")
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
      snapshotPath: join(reportsRoot, "missing.json")
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
