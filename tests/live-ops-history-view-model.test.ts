import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildLiveOpsHistoryViewModel } from "../src/dashboard/live-ops-history-view-model.js";

describe("live operations history view model", () => {
  it("returns bounded chronological summaries and skips malformed snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "live-ops-history-"));
    await mkdir(root, { recursive: true });
    await snapshot(root, "2026-09-18T20-00-00.000Z.json", "2026-09-18T20:00:00Z", 100000);
    await snapshot(root, "2026-09-19T20-00-00.000Z.json", "2026-09-19T20:00:00Z", 100010);
    await snapshot(root, "2026-09-20T20-00-00.000Z.json", "2026-09-20T20:00:00Z", 100020);
    await writeFile(join(root, "2026-09-17.json"), "not-json");
    await writeFile(join(root, "break-even-audit.json"), "not-a-snapshot");

    const result = await buildLiveOpsHistoryViewModel(root, 2);

    expect(result.totalAvailable).toBe(3);
    expect(result.invalidFileCount).toBe(1);
    expect(result.entries.map((entry) => entry.equity)).toEqual([100010, 100020]);
    expect(result.entries[1]).toMatchObject({
      status: "ready",
      executable: true,
      dayPnl: 3,
      grossExposure: 25,
      positionCount: 1,
      orderCount: 1,
      decisionCount: 1,
      dryRun: true,
      executionCount: 0
    });
  });

  it("returns an empty index for a missing directory and validates limits", async () => {
    const root = join(await mkdtemp(join(tmpdir(), "live-ops-missing-")), "missing");
    await expect(buildLiveOpsHistoryViewModel(root)).resolves.toEqual({
      entries: [],
      totalAvailable: 0,
      invalidFileCount: 0
    });
    await expect(buildLiveOpsHistoryViewModel(root, 0)).rejects.toThrow("1 through 500");
  });

  it("includes read-only snapshots that do not have a coordinator run summary", async () => {
    const root = await mkdtemp(join(tmpdir(), "live-ops-read-only-"));
    await writeFile(
      join(root, "2026-09-20.json"),
      JSON.stringify({
        updatedAt: "2026-09-20T20:00:00Z",
        headlineStatus: "warning",
        executable: true,
        account: {
          equity: 100000,
          dayRealizedPnl: 0,
          dayUnrealizedPnl: 0,
          grossExposure: 0
        },
        positions: [],
        orders: []
      })
    );

    const result = await buildLiveOpsHistoryViewModel(root);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).not.toHaveProperty("dryRun");
  });
});

async function snapshot(
  root: string,
  name: string,
  updatedAt: string,
  equity: number
): Promise<void> {
  await writeFile(
    join(root, name),
    JSON.stringify({
      updatedAt,
      headlineStatus: "ready",
      executable: true,
      account: {
        equity,
        dayRealizedPnl: 1,
        dayUnrealizedPnl: 2,
        grossExposure: 25
      },
      positions: [{}],
      orders: [{}],
      paperCycles: [{}],
      paperRun: { dryRun: true, executionCount: 0 }
    })
  );
}
