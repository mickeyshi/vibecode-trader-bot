import { describe, expect, it } from "vitest";
import type { Candle } from "../src/core/types.js";
import { runEtfMomentumWalkForward } from "../src/eval/etf-momentum-walk-forward.js";

describe("ETF momentum walk-forward", () => {
  it("selects only on earlier training windows and evaluates later folds", () => {
    const candles: Candle[] = [];
    for (let day = 0; day < 1_100; day += 1) {
      const time = new Date(Date.UTC(2020, 0, 1 + day));
      for (const [symbol, slope] of [
        ["SPY", 0.0005],
        ["QQQ", 0.001],
        ["IEF", 0.0001]
      ] as const) {
        const close = 100 * (1 + slope) ** day;
        candles.push({
          symbol,
          timeframe: "1d",
          openTime: time,
          closeTime: time,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1_000_000
        });
      }
    }
    const result = runEtfMomentumWalkForward(candles, undefined, 504, 252);
    expect(result.folds).toHaveLength(2);
    expect(result.folds.every((fold) => fold.trainEnd < fold.testStart)).toBe(true);
    expect(Number.isFinite(result.compoundedStrategyReturnPct)).toBe(true);
  });
});
