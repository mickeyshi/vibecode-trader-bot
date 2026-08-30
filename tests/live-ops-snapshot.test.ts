import { describe, expect, it } from "vitest";
import type { AccountSnapshot } from "../src/portfolio/interfaces.js";
import {
  buildLiveOpsSnapshot,
  loadLiveOpsSnapshotConfig
} from "../src/dashboard/live-ops-snapshot.js";

describe("live ops snapshot", () => {
  it("builds a dashboard snapshot from account state and readiness gates", () => {
    const snapshot = buildLiveOpsSnapshot(
      makeAccountSnapshot({ equity: 10_001, realizedPnl: 1 }),
      {
        mode: "paper",
        dayStartingEquity: 10_000,
        dayFeesPaid: 2,
        maxDailyLoss: 100,
        maxGrossExposurePct: 25,
        liveTradingEnabled: false,
        operatorConfirmedLive: false,
        killSwitchArmed: true,
        stopAfterBreakEven: true,
        brokerCredentialsConfigured: true,
        requirePriorBreakEvenAudit: false
      },
      [],
      [
        {
          id: "paper-1",
          timestamp: "2026-06-19T14:30:00.000Z",
          strategyId: "buy-and-hold",
          symbol: "SPY",
          side: "buy",
          quantity: 1,
          status: "filled",
          reason: "test"
        }
      ],
      {
        dryRun: false,
        submittedNotional: 25,
        maxNotionalPerRun: 100,
        executionCount: 1,
        maxExecutionsPerRun: 5,
        skippedCount: 0
      },
      [
        {
          id: "cycle-1",
          timestamp: "2026-06-19T14:30:00.000Z",
          strategyId: "buy-and-hold",
          symbol: "SPY",
          action: "buy",
          confidence: 1,
          reason: "test",
          status: "submitted",
          riskApproved: true,
          orderStatus: "filled"
        }
      ]
    );

    expect(snapshot.mode).toBe("paper");
    expect(snapshot.executable).toBe(true);
    expect(snapshot.orders[0]).toMatchObject({
      id: "paper-1",
      status: "filled"
    });
    expect(snapshot.paperRun).toEqual({
      dryRun: false,
      submittedNotional: 25,
      maxNotionalPerRun: 100,
      executionCount: 1,
      maxExecutionsPerRun: 5,
      skippedCount: 0
    });
    expect(snapshot.paperCycles?.[0]).toMatchObject({
      id: "cycle-1",
      symbol: "SPY",
      status: "submitted"
    });
    expect(snapshot.breakEven.remainingToBreakEven).toBe(1);
    expect(snapshot.readinessChecks.find((check) => check.id === "break-even-lock")).toMatchObject({
      status: "ready"
    });
  });

  it("locks execution when break-even target has been met", () => {
    const snapshot = buildLiveOpsSnapshot(makeAccountSnapshot({ equity: 10_003 }), {
      mode: "paper",
      dayStartingEquity: 10_000,
      dayFeesPaid: 2,
      maxDailyLoss: 100,
      maxGrossExposurePct: 25,
      liveTradingEnabled: false,
      operatorConfirmedLive: false,
      killSwitchArmed: true,
      stopAfterBreakEven: true,
      brokerCredentialsConfigured: true,
      requirePriorBreakEvenAudit: false
    });

    expect(snapshot.executable).toBe(false);
    expect(snapshot.breakEven.remainingToBreakEven).toBe(0);
    expect(snapshot.readinessChecks.find((check) => check.id === "break-even-lock")).toMatchObject({
      status: "blocked"
    });
  });

  it("blocks the snapshot when daily loss or gross exposure limits are breached", () => {
    const snapshot = buildLiveOpsSnapshot(
      makeAccountSnapshot({ equity: 10_000, realizedPnl: -125, grossExposure: 4_000 }),
      {
        mode: "paper",
        dayStartingEquity: 10_000,
        dayFeesPaid: 0,
        maxDailyLoss: 100,
        maxGrossExposurePct: 25,
        liveTradingEnabled: false,
        operatorConfirmedLive: false,
        killSwitchArmed: true,
        stopAfterBreakEven: false,
        brokerCredentialsConfigured: true,
        requirePriorBreakEvenAudit: false
      }
    );

    expect(snapshot.headlineStatus).toBe("blocked");
    expect(snapshot.riskLimits.map((limit) => [limit.label, limit.status])).toEqual([
      ["Daily loss", "blocked"],
      ["Gross exposure", "blocked"]
    ]);
  });

  it("loads snapshot controls from environment-like values", () => {
    expect(
      loadLiveOpsSnapshotConfig({
        ALPACA_TRADING_MODE: "paper",
        LIVE_OPS_DAY_STARTING_EQUITY: "10000",
        LIVE_OPS_DAY_FEES_PAID: "2.50",
        LIVE_TRADING_ENABLED: "false",
        LIVE_OPERATOR_CONFIRMED: "false",
        LIVE_KILL_SWITCH_ARMED: "true",
        LIVE_STOP_AFTER_BREAK_EVEN: "true",
        ALPACA_TRADING_API_KEY_ID: "key",
        ALPACA_TRADING_API_SECRET_KEY: "secret"
      })
    ).toMatchObject({
      mode: "paper",
      dayStartingEquity: 10_000,
      dayFeesPaid: 2.5,
      maxDailyLoss: 100,
      maxGrossExposurePct: 25,
      brokerCredentialsConfigured: true,
      requirePriorBreakEvenAudit: false
    });
  });

  it("requires an explicit day starting equity", () => {
    expect(() => loadLiveOpsSnapshotConfig({})).toThrow("LIVE_OPS_DAY_STARTING_EQUITY");
  });
});

function makeAccountSnapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    equity: 10_000,
    cash: 9_000,
    buyingPower: 9_000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    positionValue: 1_000,
    grossExposure: 1_000,
    currency: "USD",
    timestamp: new Date("2026-06-19T14:30:00.000Z"),
    ...overrides
  };
}
