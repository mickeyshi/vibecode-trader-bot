import { describe, expect, it } from "vitest";
import {
  buildLiveOpsDashboardFromAccountSnapshot,
  buildLiveOpsDashboardViewModel
} from "../src/dashboard/live-ops-view-model.js";

describe("live ops view model", () => {
  it("calculates the day break-even gap after fees", () => {
    const viewModel = buildLiveOpsDashboardViewModel({
      mode: "paper",
      executable: true,
      updatedAt: "2026-06-19T14:30:00.000Z",
      startingEquity: 10_000,
      feesPaidToday: 5,
      account: {
        equity: 10_002,
        cash: 9_000,
        buyingPower: 9_000,
        grossExposure: 1_000,
        dayRealizedPnl: 1,
        dayUnrealizedPnl: 1,
        currency: "USD"
      },
      tradingControls: [],
      riskLimits: [],
      positions: [],
      orders: [],
      readinessChecks: [],
      breakEvenAudit: {
        dayCount: 2,
        metCount: 2,
        missedCount: 0,
        currentStreak: 2,
        longestStreak: 2,
        allDaysMet: true
      }
    });

    expect(viewModel.breakEven.targetEquity).toBe(10_005);
    expect(viewModel.executable).toBe(true);
    expect(viewModel.breakEvenAudit).toMatchObject({
      dayCount: 2,
      allDaysMet: true
    });
    expect(viewModel.breakEven.remainingToBreakEven).toBe(3);
    expect(viewModel.breakEven.progressPct).toBe(40);
  });

  it("uses the most severe live readiness status", () => {
    const viewModel = buildLiveOpsDashboardViewModel({
      mode: "paper",
      executable: false,
      updatedAt: new Date("2026-06-19T14:30:00.000Z"),
      startingEquity: 10_000,
      feesPaidToday: 0,
      account: {
        equity: 10_000,
        cash: 10_000,
        buyingPower: 10_000,
        grossExposure: 0,
        dayRealizedPnl: 0,
        dayUnrealizedPnl: 0,
        currency: "USD"
      },
      tradingControls: [
        { id: "kill-switch", label: "Kill switch", value: "Armed", status: "ready" }
      ],
      riskLimits: [
        { label: "Daily loss", used: 0, limit: 100, unit: "currency", status: "warning" }
      ],
      positions: [],
      orders: [],
      readinessChecks: [
        {
          id: "broker",
          label: "Live broker executor",
          detail: "Not implemented.",
          status: "blocked"
        }
      ]
    });

    expect(viewModel.headlineStatus).toBe("blocked");
    expect(viewModel.executable).toBe(false);
  });

  it("builds live ops account fields from account snapshots", () => {
    const viewModel = buildLiveOpsDashboardFromAccountSnapshot({
      mode: "paper",
      executable: true,
      accountSnapshot: {
        equity: 10_010,
        cash: 9_500,
        buyingPower: 19_000,
        realizedPnl: 2,
        unrealizedPnl: 8,
        positionValue: 510,
        grossExposure: 510,
        currency: "USD",
        timestamp: new Date("2026-06-19T14:30:00.000Z")
      },
      dayStartingEquity: 10_000,
      dayFeesPaid: 1,
      tradingControls: [],
      riskLimits: [],
      positions: [],
      orders: [],
      readinessChecks: []
    });

    expect(viewModel.updatedAt).toBe("2026-06-19T14:30:00.000Z");
    expect(viewModel.account).toMatchObject({
      equity: 10_010,
      dayRealizedPnl: 2,
      dayUnrealizedPnl: 8,
      grossExposure: 510
    });
    expect(viewModel.breakEven.remainingToBreakEven).toBe(0);
  });
});
