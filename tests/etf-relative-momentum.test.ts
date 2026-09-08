import { describe, expect, it } from "vitest";
import type { Candle } from "../src/core/types.js";
import { runEtfRelativeMomentum } from "../src/eval/etf-relative-momentum.js";

describe("ETF relative momentum research simulation", () => {
  it("runs a prior-close monthly rotation without leverage", () => {
    const candles: Candle[] = [];
    for (let day = 0; day < 320; day += 1) {
      const time = new Date(Date.UTC(2024, 0, 1 + day));
      for (const [symbol, slope] of [
        ["SPY", 0.001],
        ["QQQ", 0.002],
        ["IEF", -0.0002]
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
    const result = runEtfRelativeMomentum(candles, undefined, 100_000);
    expect(result.rebalanceCount).toBeGreaterThan(5);
    expect(result.strategy.endingEquity).toBeGreaterThan(100_000);
    expect(result.strategy.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it("refuses insufficient history", () => {
    expect(() => runEtfRelativeMomentum([])).toThrow("Not enough daily candles");
  });
});
