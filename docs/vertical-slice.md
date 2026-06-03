# First Vertical Slice

This pass proves the bot can move data through the core architecture without choosing a broker, database, or hosted runtime.

## Implemented Flow

```text
Fixture candles
  -> InMemoryMarketDataStore
  -> SimpleFeatureBuilder
  -> MovingAverageCrossoverStrategy
  -> FixedNotionalIntentMapper
  -> BasicRiskEngine
  -> PaperOrderExecutor
  -> InMemoryPortfolioStore
  -> BacktestReport
```

## Current Behavior

- Market data is demo candle data, not a live feed.
- Strategy is a simple moving-average crossover.
- Risk blocks oversized orders, oversized projected positions, daily-loss breaches, and high-impact events.
- Risk also blocks buys that exceed buying power and sells that would create short positions by default.
- Paper execution fills immediately at the latest candle close with configurable fee and slippage assumptions.
- Portfolio state tracks cash, realized PnL, fills, orders, positions, and marked-to-market equity.
- Backtest output reports ending equity, total return, max drawdown, order count, fill count, risk rejection count, equity point count, and assumptions.
- Optional JSON report export includes full orders, fills, risk rejections, and the equity curve.

## Intentional Limitations

This is a framework validation slice, not a profitability model. It does not include realistic order books, partial fills, latency, exchange outages, borrow costs, taxes, spread modeling, or explicit short/leverage modeling.

## Run It

```bash
npm run backtest
npm run backtest -- test-fixtures/demo-candles.csv
npm run backtest -- test-fixtures/demo-candles.json
npm run backtest -- --fixture test-fixtures/stooq-1mcay-sample.txt --symbol 1MCAY.B
npm run backtest -- --starting-equity 25000 --fee-rate 0.0005 --slippage-bps 2
npm run backtest -- --report reports/backtest.json
npm run backtest -- --help
npm test
npm run typecheck
```

## Next Improvements

Track the fuller roadmap in `docs/spec-gaps.md`.

- Curate a small Stooq fixture for routine tests.
- Add config-file support if CLI flags become too noisy for repeated experiments.
- Add CSV export if spreadsheet-oriented reporting becomes useful.
- Add replay mode that uses the same loop as paper trading.
- Add config validation before adding external feeds or exchange integrations.
