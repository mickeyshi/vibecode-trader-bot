import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  loadBacktestCliConfig,
  parseBacktestCliArgs,
  summarizeBacktestReport
} from "../src/eval/backtest-cli.js";
import type { BacktestReport } from "../src/eval/interfaces.js";

describe("backtest CLI helpers", () => {
  it("parses named options for a configurable backtest run", () => {
    const config = parseBacktestCliArgs([
      "--fixture",
      "test-fixtures/stooq-1mcay-sample.txt",
      "--symbol",
      "1MCAY.B",
      "--strategy",
      "buy-and-hold",
      "--compare-strategies",
      "moving-average-crossover,buy-and-hold",
      "--strategy-param",
      "shortWindow=2",
      "--from",
      "2020-01-01",
      "--to",
      "2020-12-31",
      "--starting-equity",
      "25000",
      "--fee-rate=0.0005",
      "--slippage-bps",
      "2",
      "--spread-bps",
      "4",
      "--fill-ratio",
      "0.5",
      "--skip-fill-every",
      "3",
      "--max-data-gap-days",
      "6",
      "--market-calendar",
      "crypto-24-7",
      "--market-holidays",
      "2026-01-01,2026-12-25",
      "--short-window",
      "4",
      "--long-window",
      "9",
      "--min-confidence",
      "0.02",
      "--report",
      "reports/backtest.json"
    ]);

    expect(config.fixturePath).toBe("test-fixtures/stooq-1mcay-sample.txt");
    expect(config.symbol).toBe("1MCAY.B");
    expect(config.strategyId).toBe("buy-and-hold");
    expect(config.compareStrategyIds).toEqual(["moving-average-crossover", "buy-and-hold"]);
    expect(config.strategyParams).toMatchObject({ shortWindow: 4, longWindow: 9 });
    expect(config.from).toBe("2020-01-01");
    expect(config.to).toBe("2020-12-31");
    expect(config.startingEquity).toBe(25_000);
    expect(config.feeRate).toBe(0.0005);
    expect(config.slippageBps).toBe(2);
    expect(config.spreadBps).toBe(4);
    expect(config.fillRatio).toBe(0.5);
    expect(config.skipFillEvery).toBe(3);
    expect(config.maxDataGapDays).toBe(6);
    expect(config.marketCalendar).toBe("crypto-24-7");
    expect(config.marketHolidays).toEqual(["2026-01-01", "2026-12-25"]);
    expect(config.shortWindow).toBe(4);
    expect(config.longWindow).toBe(9);
    expect(config.minConfidence).toBe(0.02);
    expect(config.reportPath).toBe("reports/backtest.json");
  });

  it("keeps positional fixture and symbol compatibility", () => {
    const config = parseBacktestCliArgs(["test-fixtures/demo-candles.csv", "DEMO/USD"]);

    expect(config.fixturePath).toBe("test-fixtures/demo-candles.csv");
    expect(config.symbol).toBe("DEMO/USD");
  });

  it("loads JSON config files and lets CLI flags override file values", async () => {
    await mkdir("reports", { recursive: true });
    await writeFile(
      "reports/test-backtest-config.json",
      JSON.stringify({
        fixturePath: "test-fixtures/stooq-1mcay-sample.txt",
        symbol: "1MCAY.B",
        strategyId: "moving-average-crossover",
        strategyParams: {
          shortWindow: 2,
          longWindow: 8
        },
        compareStrategyIds: ["moving-average-crossover", "buy-and-hold"],
        from: "1994-01-01",
        to: "1994-12-31",
        startingEquity: 25_000,
        marketCalendar: "weekday",
        marketHolidays: ["2026-01-01"],
        shortWindow: 2,
        longWindow: 8
      }),
      "utf8"
    );

    const config = await loadBacktestCliConfig([
      "--config",
      "reports/test-backtest-config.json",
      "--starting-equity",
      "30000"
    ]);

    expect(config.configPath).toBe("reports/test-backtest-config.json");
    expect(config.fixturePath).toBe("test-fixtures/stooq-1mcay-sample.txt");
    expect(config.symbol).toBe("1MCAY.B");
    expect(config.strategyId).toBe("moving-average-crossover");
    expect(config.strategyParams).toMatchObject({ shortWindow: 2, longWindow: 8 });
    expect(config.compareStrategyIds).toEqual(["moving-average-crossover", "buy-and-hold"]);
    expect(config.from).toBe("1994-01-01");
    expect(config.to).toBe("1994-12-31");
    expect(config.startingEquity).toBe(30_000);
    expect(config.marketCalendar).toBe("weekday");
    expect(config.marketHolidays).toEqual(["2026-01-01"]);
    expect(config.shortWindow).toBe(2);
    expect(config.longWindow).toBe(8);
  });

  it("rejects unknown JSON config keys", async () => {
    await mkdir("reports", { recursive: true });
    await writeFile(
      "reports/test-invalid-backtest-config.json",
      JSON.stringify({
        fixturePath: "test-fixtures/stooq-1mcay-sample.txt",
        unknownOption: true
      }),
      "utf8"
    );

    await expect(
      loadBacktestCliConfig(["--config", "reports/test-invalid-backtest-config.json"])
    ).rejects.toThrow("Unknown backtest config key");
  });

  it("rejects invalid JSON config value types", async () => {
    await mkdir("reports", { recursive: true });
    await writeFile(
      "reports/test-invalid-type-backtest-config.json",
      JSON.stringify({
        startingEquity: "25000"
      }),
      "utf8"
    );

    await expect(
      loadBacktestCliConfig(["--config", "reports/test-invalid-type-backtest-config.json"])
    ).rejects.toThrow("startingEquity must be a positive number");
  });

  it("rejects invalid moving-average windows", () => {
    expect(() => parseBacktestCliArgs(["--short-window", "5", "--long-window", "5"])).toThrow(
      "--short-window must be less than --long-window"
    );
  });

  it("summarizes a full report without dumping all report rows", () => {
    const report: BacktestReport = {
      strategyId: "test-strategy",
      start: new Date("2026-01-01T00:00:00.000Z"),
      end: new Date("2026-01-02T00:00:00.000Z"),
      endingEquity: 10_123.456,
      totalReturnPct: 1.23456,
      maxDrawdownPct: 0.54321,
      orders: [],
      fills: [],
      trades: [
        {
          id: "trade-1",
          symbol: "DEMO/USD",
          side: "long",
          entryTimestamp: new Date("2026-01-01T00:00:00.000Z"),
          exitTimestamp: new Date("2026-01-02T00:00:00.000Z"),
          quantity: 1,
          averageEntryPrice: 100,
          exitPrice: 110,
          entryCost: 100,
          exitProceeds: 110,
          fees: 1,
          pnl: 9,
          returnPct: 9
        }
      ],
      riskRejections: [],
      equityCurve: [
        { timestamp: new Date("2026-01-01T00:00:00.000Z"), equity: 10_000 },
        { timestamp: new Date("2026-01-02T00:00:00.000Z"), equity: 10_123.456 }
      ],
      metrics: {
        startingEquity: 10_000,
        endingEquity: 10_123.456,
        endingCash: 9_000,
        finalPositionValue: 1_123.456,
        finalGrossExposure: 1_123.456,
        finalRealizedPnl: 23.456,
        finalUnrealizedPnl: 100,
        netProfit: 123.456,
        totalFees: 12.345,
        filledOrderCount: 0,
        skippedOrderCount: 1,
        closedTradeCount: 2,
        winningTradeCount: 1,
        losingTradeCount: 1,
        winRatePct: 50,
        grossProfit: 100,
        grossLoss: 40,
        profitFactor: 2.5
      },
      dataQualityWarnings: [
        {
          type: "missing-data-gap",
          symbol: "DEMO/USD",
          calendar: "weekday",
          previousTimestamp: new Date("2026-01-01T00:00:00.000Z"),
          currentTimestamp: new Date("2026-01-02T00:00:00.000Z"),
          gapDays: 1,
          missingSessionCount: 1,
          message: "test gap"
        }
      ],
      assumptions: ["test assumption"]
    };

    expect(summarizeBacktestReport(report)).toMatchObject({
      endingEquity: 10123.46,
      endingCash: 9000,
      finalPositionValue: 1123.46,
      finalGrossExposure: 1123.46,
      finalRealizedPnl: 23.46,
      finalUnrealizedPnl: 100,
      totalReturnPct: 1.23,
      maxDrawdownPct: 0.54,
      equityPointCount: 2,
      netProfit: 123.46,
      totalFees: 12.35,
      skippedOrderCount: 1,
      closedTradeCount: 2,
      winningTradeCount: 1,
      losingTradeCount: 1,
      winRatePct: 50,
      grossProfit: 100,
      grossLoss: 40,
      profitFactor: 2.5,
      dataQualityWarningCount: 1
    });
  });
});
