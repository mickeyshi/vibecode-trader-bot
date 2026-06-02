import type { Candle } from "../core/types.js";
import { loadCandlesFromFixture } from "../fixtures/candle-fixture-loader.js";
import { SimpleBacktester } from "./simple-backtester.js";
import { MovingAverageCrossoverStrategy } from "../strategies/moving-average-crossover-strategy.js";

// CLI usage:
//   npm run backtest
//   npm run backtest -- test-fixtures/demo-candles.csv
//   npm run backtest -- test-fixtures/data/daily/world/currencies/other/usdbtc.txt
const fixturePath = process.argv[2];
const requestedSymbol = process.argv[3];

// With no path, use a tiny synthetic data set. With a path, load CSV/JSON/Stooq text data
// so the same runner can handle both deterministic fixtures and larger downloaded samples.
const candles = fixturePath
  ? await loadCandlesFromFixture(fixturePath, {
      symbol: requestedSymbol ?? "DEMO/USD",
      timeframe: "1d"
    })
  : makeDemoCandles();
const symbol = requestedSymbol ?? candles.at(0)?.symbol ?? "DEMO/USD";

// This strategy is intentionally simple. It is here to exercise the pipeline, not to claim
// that moving-average crossover is a profitable trading approach.
const strategy = new MovingAverageCrossoverStrategy({
  shortWindow: 3,
  longWindow: 5,
  minConfidence: 0.01
});
const backtester = new SimpleBacktester({ strategy });

// The assumptions here are deliberately visible because fees and slippage can dominate
// backtest results. Future config loading should make these command-line options.
const report = await backtester.run({
  strategyId: strategy.id,
  symbols: [symbol],
  candles,
  startingEquity: 10_000,
  feeRate: 0.001,
  slippageBps: 5
});

// Print a compact summary instead of every order/fill. The full report object still carries
// orders and fills for future export or debugging.
console.log(
  JSON.stringify(
    {
      strategyId: report.strategyId,
      start: report.start.toISOString(),
      end: report.end.toISOString(),
      endingEquity: Number(report.endingEquity.toFixed(2)),
      totalReturnPct: Number(report.totalReturnPct.toFixed(2)),
      maxDrawdownPct: Number(report.maxDrawdownPct.toFixed(2)),
      orderCount: report.orders.length,
      fillCount: report.fills.length,
      riskRejectionCount: report.riskRejections.length,
      assumptions: report.assumptions
    },
    null,
    2
  )
);

function makeDemoCandles(): Candle[] {
  // Small upward-trending fixture used as a smoke test when no external file is supplied.
  const closes = [100, 99, 98, 99, 101, 103, 105, 107, 106, 108];
  const start = Date.UTC(2026, 0, 1, 9, 30);

  return closes.map((close, index) => {
    const open = index === 0 ? close : (closes[index - 1] ?? close);
    const openTime = new Date(start + index * 60_000);
    const closeTime = new Date(start + (index + 1) * 60_000);

    return {
      symbol: "DEMO/USD",
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
