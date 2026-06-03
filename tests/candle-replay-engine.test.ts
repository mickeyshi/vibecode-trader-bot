import { describe, expect, it } from "vitest";
import { CandleReplayEngine } from "../src/eval/candle-replay-engine.js";
import { makeCandles } from "./fixtures.js";
import { MovingAverageCrossoverStrategy } from "../src/strategies/moving-average-crossover-strategy.js";

describe("CandleReplayEngine", () => {
  it("replays candles through market data, strategy, risk, execution, and portfolio state", async () => {
    const strategy = new MovingAverageCrossoverStrategy({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.01
    });
    const engine = new CandleReplayEngine({ strategy });

    const result = await engine.run({
      symbols: ["DEMO/USD"],
      candles: makeCandles([100, 99, 100, 102, 104, 106, 108]),
      startingEquity: 10_000,
      execution: {
        feeRate: 0.001,
        slippageBps: 5
      },
      riskDefaults: {
        maxOrderNotional: 2_000,
        maxPositionNotional: 5_000,
        maxDailyLossPct: 0.05,
        blockHighImpactEventsAtOrAbove: 10,
        maxGrossLeverage: 1,
        estimatedFeeRate: 0.001,
        estimatedSlippageBps: 5
      },
      notionalPerTrade: 1_000,
      maxDataGapDays: 4,
      marketCalendar: "weekday"
    });

    expect(result.equityCurve.length).toBeGreaterThan(1);
    expect(result.orders.length).toBeGreaterThan(0);
    expect(result.fills.length).toBe(result.orders.length);
    expect(result.finalSnapshot.equity).toBeGreaterThan(0);
    expect(result.assumptions).toContain("Market calendar: weekday.");
  });
});
