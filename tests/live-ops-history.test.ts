import { mkdir, readFile, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  loadLiveOpsHistory,
  writeLiveOpsHistorySnapshot
} from "../src/dashboard/live-ops-history.js";
import type { LiveOpsDashboardViewModel } from "../src/dashboard/live-ops-view-model.js";

describe("live ops history", () => {
  it("writes a dated snapshot, latest snapshot, and audit summary", async () => {
    const historyDir = "reports/history-test";
    const latestPath = "reports/history-test/latest.json";

    await writeLiveOpsHistorySnapshot(makeSnapshot("2026-06-19T20:00:00.000Z", 10_000), {
      historyDir,
      latestPath
    });
    const result = await writeLiveOpsHistorySnapshot(
      makeSnapshot("2026-06-20T20:00:00.000Z", 10_002),
      {
        historyDir,
        latestPath
      }
    );

    expect(result.historyPath.endsWith("2026-06-20T20-00-00.000Z.json")).toBe(true);
    expect(result.audit).toMatchObject({
      dayCount: 2,
      metCount: 2,
      allDaysMet: true
    });

    const latest = JSON.parse(await readFile(latestPath, "utf8")) as LiveOpsDashboardViewModel;
    expect(latest.breakEvenAudit).toMatchObject({
      dayCount: 2,
      currentStreak: 2
    });

    const audit = JSON.parse(await readFile(`${historyDir}/break-even-audit.json`, "utf8")) as {
      allDaysMet: boolean;
    };
    expect(audit.allDaysMet).toBe(true);
  });

  it("retains multiple same-day runs but counts one break-even day", async () => {
    const historyDir = "reports/history-multiple-runs-test";
    const latestPath = `${historyDir}/latest.json`;
    const first = makeSnapshot("2026-06-21T14:00:00.000Z", 9_999);
    first.paperRun = {
      dryRun: false,
      submittedNotional: 25,
      maxNotionalPerRun: 25,
      executionCount: 1,
      maxExecutionsPerRun: 1,
      skippedCount: 0
    };
    await writeLiveOpsHistorySnapshot(first, { historyDir, latestPath });
    const result = await writeLiveOpsHistorySnapshot(
      makeSnapshot("2026-06-21T15:00:00.000Z", 10_001),
      { historyDir, latestPath }
    );

    const history = await loadLiveOpsHistory(historyDir);
    expect(history).toHaveLength(2);
    expect(history[0]?.paperRun?.executionCount).toBe(1);
    expect(result.audit.dayCount).toBe(1);
    expect(result.audit.metCount).toBe(1);
  });

  it("loads only dated live-ops history files", async () => {
    const historyDir = "reports/history-load-test";
    await mkdir(historyDir, { recursive: true });
    await writeFile(
      `${historyDir}/2026-06-19.json`,
      JSON.stringify(makeSnapshot("2026-06-19T20:00:00.000Z", 10_000)),
      "utf8"
    );
    await writeFile(
      `${historyDir}/break-even-audit.json`,
      JSON.stringify({ ignored: true }),
      "utf8"
    );
    await writeFile(`${historyDir}/notes.json`, JSON.stringify({ ignored: true }), "utf8");

    const history = await loadLiveOpsHistory(historyDir);

    expect(history).toHaveLength(1);
    expect(history[0]?.updatedAt).toBe("2026-06-19T20:00:00.000Z");
  });

  it("treats missing history directories as empty history", async () => {
    await expect(loadLiveOpsHistory("reports/history-missing-test")).resolves.toEqual([]);
  });
});

function makeSnapshot(updatedAt: string, currentEquity: number): LiveOpsDashboardViewModel {
  return {
    mode: "paper",
    executable: true,
    headlineStatus: "ready",
    updatedAt,
    account: {
      equity: currentEquity,
      cash: currentEquity,
      buyingPower: currentEquity,
      grossExposure: 0,
      dayRealizedPnl: currentEquity - 10_000,
      dayUnrealizedPnl: 0,
      currency: "USD"
    },
    breakEven: {
      startingEquity: 10_000,
      currentEquity,
      targetEquity: 10_000,
      feesPaidToday: 0,
      remainingToBreakEven: Math.max(0, 10_000 - currentEquity),
      progressPct: 100
    },
    tradingControls: [],
    riskLimits: [],
    positions: [],
    orders: [],
    readinessChecks: []
  };
}
