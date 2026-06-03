import { describe, expect, it } from "vitest";
import { parseBacktestCliArgs, summarizeBacktestReport } from "../src/eval/backtest-cli.js";
import type { BacktestReport } from "../src/eval/interfaces.js";

describe("backtest CLI helpers", () => {
  it("parses named options for a configurable backtest run", () => {
    const config = parseBacktestCliArgs([
      "--fixture",
      "test-fixtures/stooq-1mcay-sample.txt",
      "--symbol",
      "1MCAY.B",
      "--starting-equity",
      "25000",
      "--fee-rate=0.0005",
      "--slippage-bps",
      "2",
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
    expect(config.startingEquity).toBe(25_000);
    expect(config.feeRate).toBe(0.0005);
    expect(config.slippageBps).toBe(2);
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
      riskRejections: [],
      equityCurve: [
        { timestamp: new Date("2026-01-01T00:00:00.000Z"), equity: 10_000 },
        { timestamp: new Date("2026-01-02T00:00:00.000Z"), equity: 10_123.456 }
      ],
      assumptions: ["test assumption"]
    };

    expect(summarizeBacktestReport(report)).toMatchObject({
      endingEquity: 10123.46,
      totalReturnPct: 1.23,
      maxDrawdownPct: 0.54,
      equityPointCount: 2
    });
  });
});
