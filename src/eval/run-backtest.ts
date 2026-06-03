import type { Candle } from "../core/types.js";
import { loadCandlesFromFixture } from "../fixtures/candle-fixture-loader.js";
import { SimpleBacktester } from "./simple-backtester.js";
import { MovingAverageCrossoverStrategy } from "../strategies/moving-average-crossover-strategy.js";
import {
  backtestHelpText,
  loadBacktestCliConfig,
  summarizeBacktestReport,
  writeBacktestCsvReports,
  writeBacktestReport
} from "./backtest-cli.js";

// CLI usage:
//   npm run backtest
//   npm run backtest -- test-fixtures/demo-candles.csv
//   npm run backtest -- --fixture test-fixtures/stooq-1mcay-sample.txt --symbol 1MCAY.B
//   npm run backtest -- --config backtest.config.example.json
//   npm run backtest -- --report reports/backtest.json
const cli = await loadBacktestCliConfig(process.argv.slice(2));

if (cli.help) {
  console.log(backtestHelpText());
  process.exit(0);
}

// With no path, use a tiny synthetic data set. With a path, load CSV/JSON/Stooq text data
// so the same runner can handle both deterministic fixtures and larger downloaded samples.
const candles = cli.fixturePath
  ? await loadCandlesFromFixture(cli.fixturePath, {
      symbol: cli.symbol ?? "DEMO/USD",
      timeframe: "1d"
    })
  : makeDemoCandles();
const symbol = cli.symbol ?? candles.at(0)?.symbol ?? "DEMO/USD";

// This strategy is intentionally simple. It is here to exercise the pipeline, not to claim
// that moving-average crossover is a profitable trading approach.
const strategy = new MovingAverageCrossoverStrategy({
  shortWindow: cli.shortWindow,
  longWindow: cli.longWindow,
  minConfidence: cli.minConfidence
});
const backtester = new SimpleBacktester({ strategy });

// Fees and slippage can dominate backtest results, so the CLI keeps these assumptions explicit.
const request = {
  strategyId: strategy.id,
  symbols: [symbol],
  candles,
  startingEquity: cli.startingEquity,
  feeRate: cli.feeRate,
  slippageBps: cli.slippageBps,
  spreadBps: cli.spreadBps,
  fillRatio: cli.fillRatio,
  maxDataGapDays: cli.maxDataGapDays,
  marketCalendar: cli.marketCalendar,
  marketHolidays: cli.marketHolidays,
  ...(cli.skipFillEvery !== undefined ? { skipFillEvery: cli.skipFillEvery } : {})
};
const report = await backtester.run(request);

if (cli.reportPath) {
  await writeBacktestReport(report, cli.reportPath);
}

if (cli.reportCsvDir) {
  await writeBacktestCsvReports(report, cli.reportCsvDir);
}

console.log(JSON.stringify(summarizeBacktestReport(report), null, 2));

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
