import { describe, expect, it } from "vitest";
import { SimpleBacktester } from "../src/eval/simple-backtester.js";
import { MovingAverageCrossoverStrategy } from "../src/strategies/moving-average-crossover-strategy.js";
import { makeCandles } from "./fixtures.js";

describe("SimpleBacktester", () => {
  it("runs candles through strategy, risk, paper execution, and reporting", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const backtester = new SimpleBacktester({ strategy });

    const report = await backtester.run({
      strategyId: strategy.id,
      symbols: ["DEMO/USD"],
      candles: makeCandles([100, 99, 100, 102, 104, 106, 108]),
      startingEquity: 10_000,
      feeRate: 0.001,
      slippageBps: 5
    });

    expect(report.strategyId).toBe(strategy.id);
    expect(report.orders.length).toBeGreaterThan(0);
    expect(report.fills.length).toBe(report.orders.length);
    expect(report.riskRejections.length).toBeGreaterThanOrEqual(0);
    expect(report.endingEquity).toBeGreaterThan(0);
    expect(report.assumptions).toContain("Orders fill immediately at the latest candle close.");
  });
});
