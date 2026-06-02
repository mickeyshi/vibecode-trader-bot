import type { Candle } from "../src/core/types.js";

export function makeCandles(closes: number[], symbol = "DEMO/USD"): Candle[] {
  const start = Date.UTC(2026, 0, 1, 9, 30);

  return closes.map((close, index) => {
    const open = index === 0 ? close : (closes[index - 1] ?? close);
    const openTime = new Date(start + index * 60_000);
    const closeTime = new Date(start + (index + 1) * 60_000);

    return {
      symbol,
      timeframe: "1m",
      openTime,
      closeTime,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 1_000 + index * 10
    };
  });
}
