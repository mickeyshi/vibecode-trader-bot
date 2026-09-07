import { describe, expect, it } from "vitest";
import { parsePaperCoordinatorArgs } from "../src/execution/paper-trading-coordinator-cli.js";

describe("paper trading coordinator CLI", () => {
  it("parses paper coordinator safety, sizing, session, and strategy options", () => {
    const config = parsePaperCoordinatorArgs([
      "--symbols",
      "spy,aapl",
      "--strategy",
      "moving-average-crossover",
      "--strategy-param",
      "shortWindow=2",
      "--strategy-param=longWindow=5",
      "--strategy-param",
      "minConfidence=0.01",
      "--sizing",
      "allocation",
      "--target-allocation-pct",
      "0.0025",
      "--allocation-weights",
      "SPY=0.0025,AAPL=0.0015",
      "--max-total-allocation-pct",
      "0.01",
      "--min-notional",
      "5",
      "--max-order-notional",
      "50",
      "--max-position-notional",
      "250",
      "--iterations",
      "5",
      "--interval-ms",
      "60000",
      "--max-candle-age-ms",
      "900000",
      "--max-history-candles",
      "120",
      "--max-executions-per-run",
      "2",
      "--max-notional-per-run",
      "100",
      "--max-pending-order-age-ms",
      "300000",
      "--max-position-drift-notional",
      "2.5",
      "--dry-run",
      "--market-session",
      "regular",
      "--market-session-time-zone",
      "America/New_York",
      "--market-session-open",
      "09:30",
      "--market-session-close",
      "16:00",
      "--market-session-holidays",
      "2026-07-03,2026-12-25",
      "--state",
      "reports/paper-state.json",
      "--out",
      "reports/live-ops-snapshot.json",
      "--history-dir",
      "reports/live-ops-history"
    ]);

    expect(config).toMatchObject({
      symbols: ["SPY", "AAPL"],
      strategyId: "moving-average-crossover",
      strategyParams: {
        shortWindow: 2,
        longWindow: 5,
        minConfidence: 0.01
      },
      sizingMode: "allocation",
      targetAllocationPct: 0.0025,
      allocationWeights: "SPY=0.0025,AAPL=0.0015",
      maxTotalAllocationPct: 0.01,
      minNotionalPerTrade: 5,
      maxOrderNotional: 50,
      maxPositionNotional: 250,
      iterations: 5,
      intervalMs: 60_000,
      maxCandleAgeMs: 900_000,
      maxHistoryCandles: 120,
      maxExecutionsPerRun: 2,
      maxNotionalPerRun: 100,
      maxPendingOrderAgeMs: 300_000,
      maxPositionDriftNotional: 2.5,
      dryRun: true,
      marketSessionMode: "regular",
      marketSessionTimeZone: "America/New_York",
      marketSessionOpenTime: "09:30",
      marketSessionCloseTime: "16:00",
      marketSessionHolidays: ["2026-07-03", "2026-12-25"],
      statePath: "reports/paper-state.json",
      out: "reports/live-ops-snapshot.json",
      historyDir: "reports/live-ops-history"
    });
  });

  it("keeps conservative defaults for bounded paper runs", () => {
    expect(parsePaperCoordinatorArgs([])).toMatchObject({
      strategyId: "buy-and-hold",
      strategyParams: {},
      sizingMode: "fixed-notional",
      notionalPerTrade: 25,
      targetAllocationPct: 0.0025,
      maxTotalAllocationPct: 0.025,
      minNotionalPerTrade: 1,
      maxOrderNotional: 50,
      maxPositionNotional: 250,
      iterations: 1,
      intervalMs: 0,
      maxCandleAgeMs: 900_000,
      maxHistoryCandles: 100,
      maxExecutionsPerRun: 5,
      maxNotionalPerRun: 250,
      maxPendingOrderAgeMs: 900_000,
      maxPositionDriftNotional: 5,
      dryRun: false,
      marketSessionMode: "regular"
    });
  });

  it("rejects invalid safety and mode options", () => {
    expect(() => parsePaperCoordinatorArgs(["--max-executions-per-run", "1.5"])).toThrow(
      "--max-executions-per-run must be an integer"
    );
    expect(() => parsePaperCoordinatorArgs(["--max-notional-per-run", "-1"])).toThrow(
      "--max-notional-per-run must be a non-negative finite number"
    );
    expect(() => parsePaperCoordinatorArgs(["--market-session", "always"])).toThrow(
      "--market-session must be regular or off"
    );
    expect(() => parsePaperCoordinatorArgs(["--sizing", "martingale"])).toThrow(
      "--sizing must be fixed-notional or allocation"
    );
  });
});
