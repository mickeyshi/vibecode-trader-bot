import type { Candle } from "../core/types.js";
import { loadCandlesFromFixture } from "../fixtures/candle-fixture-loader.js";
import { SimpleBacktester } from "./simple-backtester.js";
import { createDefaultStrategyRegistry } from "../strategies/registry.js";
import {
  backtestHelpText,
  loadBacktestCliConfig,
  summarizeBacktestReport,
  writeBacktestCsvReports,
  writeBacktestComparisonReport,
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
const filteredCandles = filterCandlesByDate(candles, cli.from, cli.to);
const symbol = cli.symbol ?? candles.at(0)?.symbol ?? "DEMO/USD";
const strategyIds = cli.compareStrategyIds.length > 0 ? cli.compareStrategyIds : [cli.strategyId];
const registry = createDefaultStrategyRegistry();
const reports = [];

for (const strategyId of strategyIds) {
  const strategy = registry.create(strategyId, cli.strategyParams);
  const backtester = new SimpleBacktester({ strategy });

  // Fees and slippage can dominate backtest results, so the CLI keeps these assumptions explicit.
  const request = {
    strategyId: strategy.id,
    symbols: [symbol],
    candles: filteredCandles,
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
  reports.push(await backtester.run(request));
}

if (cli.reportPath) {
  if (reports.length === 1) {
    await writeBacktestReport(reports[0]!, cli.reportPath);
  } else {
    await writeBacktestComparisonReport(reports, cli.reportPath);
  }
}

if (cli.reportCsvDir) {
  for (const report of reports) {
    const directory =
      reports.length === 1 ? cli.reportCsvDir : `${cli.reportCsvDir}/${report.strategyId}`;
    await writeBacktestCsvReports(report, directory);
  }
}

const summaries = reports.map(summarizeBacktestReport);
console.log(
  JSON.stringify(reports.length === 1 ? summaries[0] : { comparison: summaries }, null, 2)
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

function filterCandlesByDate(candles: Candle[], from?: string, to?: string): Candle[] {
  const fromTime = from ? new Date(`${from}T00:00:00.000Z`).getTime() : Number.NEGATIVE_INFINITY;
  const toTime = to ? new Date(`${to}T23:59:59.999Z`).getTime() : Number.POSITIVE_INFINITY;

  return candles.filter((candle) => {
    const closeTime = candle.closeTime.getTime();
    return closeTime >= fromTime && closeTime <= toTime;
  });
}
