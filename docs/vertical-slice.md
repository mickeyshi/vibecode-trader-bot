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
- Risk also blocks fee-aware buys that exceed buying power and sells that would create short positions by default.
- Portfolio policy is long-only, cash-only, average-cost-only, with no borrow-cost or wash-sale model.
- Paper execution fills from the latest candle close with configurable fee, slippage, spread, partial-fill, and skipped-fill assumptions.
- Portfolio state tracks cash, fee-aware cost basis, realized PnL, unrealized PnL, fills, orders, positions, gross exposure, and marked-to-market equity.
- Backtest output reports ending equity, ending cash, position value, gross exposure, realized/unrealized PnL, total return, max drawdown, order count, fill count, risk rejection count, equity point count, fees, skipped orders, closed-trade stats, data-quality warning count, and assumptions.
- Optional report exports include full JSON plus CSV files for orders, fills, closed trades, risk rejections, data-quality warnings, and the equity curve.
- Repeated backtest settings can be loaded from `backtest.config.example.json` or another JSON file with the same flat shape.
- JSON config files are validated for known keys and expected value types before running.
- Data-quality gap checks use a configured market calendar: `weekday` for exchange-style weekday sessions or `crypto-24-7` for continuously traded daily markets. Exchange holidays can be supplied as explicit `YYYY-MM-DD` dates.

## Intentional Limitations

This is a framework validation slice, not a profitability model. It does not include realistic order books, latency, exchange outages, taxes, maintained exchange holiday datasets, FIFO/LIFO tax lots, wash-sale rules, short selling, margin, or leverage.

## Run It

```bash
npm run backtest
npm run backtest -- test-fixtures/demo-candles.csv
npm run backtest -- test-fixtures/demo-candles.json
npm run backtest -- --fixture test-fixtures/stooq-1mcay-sample.txt --symbol 1MCAY.B
npm run backtest -- --starting-equity 25000 --fee-rate 0.0005 --slippage-bps 2
npm run backtest -- --spread-bps 5 --fill-ratio 0.75 --skip-fill-every 4
npm run backtest -- --config backtest.config.example.json
npm run backtest -- --market-calendar crypto-24-7
npm run backtest -- --market-holidays 2026-01-01,2026-12-25
npm run backtest -- --report reports/backtest.json
npm run backtest -- --report-csv-dir reports/backtest-csv
npm run backtest -- --help
npm test
npm run typecheck
```

## Next Improvements

Track the fuller roadmap in `docs/spec-gaps.md`.

- Curate a small Stooq fixture for routine tests.
- Add schema-backed config validation if the flat JSON config grows more complex.
- Add maintained exchange holiday datasets only if manually configured holidays become too brittle.
- Add richer per-trade analytics if the current closed-trade export is not enough for review.
- Add replay mode that uses the same loop as paper trading.
- Add config validation before adding external feeds or exchange integrations.
