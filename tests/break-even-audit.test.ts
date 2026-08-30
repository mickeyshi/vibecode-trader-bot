import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildBreakEvenAudit, loadBreakEvenAudit } from "../src/dashboard/break-even-audit.js";
import type { LiveOpsDashboardViewModel } from "../src/dashboard/live-ops-view-model.js";

describe("break-even audit", () => {
  it("marks each day that finishes at or above target equity after fees", () => {
    const audit = buildBreakEvenAudit([
      makeSnapshot("2026-06-19T20:00:00.000Z", 10_000, 2, 10_002),
      makeSnapshot("2026-06-20T20:00:00.000Z", 10_002, 1, 10_001),
      makeSnapshot("2026-06-21T20:00:00.000Z", 10_001, 1, 10_005)
    ]);

    expect(audit).toMatchObject({
      dayCount: 3,
      metCount: 2,
      missedCount: 1,
      currentStreak: 1,
      longestStreak: 1,
      allDaysMet: false
    });
    expect(audit.days.map((day) => [day.date, day.met, day.remainingToBreakEven])).toEqual([
      ["2026-06-19", true, 0],
      ["2026-06-20", false, 2],
      ["2026-06-21", true, 0]
    ]);
  });

  it("tracks consecutive successful days", () => {
    const audit = buildBreakEvenAudit([
      makeSnapshot("2026-06-19T20:00:00.000Z", 10_000, 0, 10_000),
      makeSnapshot("2026-06-20T20:00:00.000Z", 10_000, 1, 10_001),
      makeSnapshot("2026-06-21T20:00:00.000Z", 10_001, 1, 10_002)
    ]);

    expect(audit).toMatchObject({
      currentStreak: 3,
      longestStreak: 3,
      allDaysMet: true
    });
  });

  it("loads snapshots from JSON files", async () => {
    await mkdir("reports/audit-test", { recursive: true });
    await writeFile(
      "reports/audit-test/day-1.json",
      JSON.stringify(makeSnapshot("2026-06-19T20:00:00.000Z", 10_000, 0, 10_000)),
      "utf8"
    );
    await writeFile(
      "reports/audit-test/day-2.json",
      JSON.stringify(makeSnapshot("2026-06-20T20:00:00.000Z", 10_000, 2, 10_003)),
      "utf8"
    );

    const audit = await loadBreakEvenAudit([
      "reports/audit-test/day-2.json",
      "reports/audit-test/day-1.json"
    ]);

    expect(audit.days.map((day) => day.date)).toEqual(["2026-06-19", "2026-06-20"]);
    expect(audit.allDaysMet).toBe(true);
  });
});

function makeSnapshot(
  updatedAt: string,
  startingEquity: number,
  feesPaidToday: number,
  currentEquity: number
): LiveOpsDashboardViewModel {
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
      dayRealizedPnl: currentEquity - startingEquity,
      dayUnrealizedPnl: 0,
      currency: "USD"
    },
    breakEven: {
      startingEquity,
      currentEquity,
      targetEquity: startingEquity + feesPaidToday,
      feesPaidToday,
      remainingToBreakEven: Math.max(0, startingEquity + feesPaidToday - currentEquity),
      progressPct: 100
    },
    tradingControls: [],
    riskLimits: [],
    positions: [],
    orders: [],
    readinessChecks: []
  };
}
