import { describe, expect, it } from "vitest";
import type { LiveOpsDashboardViewModel } from "../src/dashboard/live-ops-view-model.js";
import { evaluatePaperSoak } from "../src/eval/paper-soak-audit.js";

describe("paper soak audit", () => {
  it("passes only when every operational acceptance gate passes", () => {
    const audit = evaluatePaperSoak(
      [snapshot("2026-06-15"), snapshot("2026-06-16"), snapshot("2026-06-17")],
      {
        minimumDays: 3,
        minimumExecutions: 3,
        maximumRejectedCycles: 0,
        maximumStaleCycles: 0
      }
    );
    expect(audit.passed).toBe(true);
    expect(audit.disclaimer).toContain("not profitability");
  });

  it("fails for blocked snapshots and stale or rejected cycles", () => {
    const bad = snapshot("2026-06-15");
    bad.headlineStatus = "blocked";
    bad.paperCycles = [
      {
        id: "c1",
        timestamp: bad.updatedAt,
        strategyId: "test",
        symbol: "SPY",
        action: "buy",
        confidence: 1,
        reason: "stale candle",
        status: "rejected"
      }
    ];
    const audit = evaluatePaperSoak([bad], {
      minimumDays: 2,
      minimumExecutions: 1,
      maximumRejectedCycles: 0,
      maximumStaleCycles: 0
    });
    expect(audit.passed).toBe(false);
    expect(audit.gates.filter((gate) => !gate.passed).map((gate) => gate.id)).toEqual(
      expect.arrayContaining([
        "minimum-days",
        "rejected-cycles",
        "stale-cycles",
        "blocked-snapshots"
      ])
    );
  });

  it("excludes snapshots that were not coordinator soak runs", () => {
    const historical = snapshot("2026-06-14");
    historical.headlineStatus = "blocked";
    delete historical.paperRun;
    const audit = evaluatePaperSoak([historical, snapshot("2026-06-15")], {
      minimumDays: 1,
      minimumExecutions: 1,
      maximumRejectedCycles: 0,
      maximumStaleCycles: 0
    });
    expect(audit.passed).toBe(true);
    expect(audit.blockedSnapshotCount).toBe(0);
    expect(audit.excludedNonRunSnapshotCount).toBe(1);
  });
});

function snapshot(date: string): LiveOpsDashboardViewModel {
  return {
    mode: "paper",
    executable: true,
    headlineStatus: "warning",
    updatedAt: `${date}T20:00:00.000Z`,
    account: {
      equity: 100000,
      cash: 99975,
      buyingPower: 399975,
      grossExposure: 25,
      dayRealizedPnl: 0,
      dayUnrealizedPnl: 0,
      currency: "USD"
    },
    breakEven: {
      startingEquity: 100000,
      currentEquity: 100000,
      targetEquity: 100000,
      feesPaidToday: 0,
      remainingToBreakEven: 0,
      progressPct: 100
    },
    tradingControls: [],
    riskLimits: [],
    positions: [],
    orders: [],
    readinessChecks: [],
    paperRun: {
      dryRun: false,
      submittedNotional: 25,
      maxNotionalPerRun: 25,
      executionCount: 1,
      maxExecutionsPerRun: 1,
      skippedCount: 0
    }
  };
}
