# First Vertical Slice

This pass proves the bot can move data through the core architecture without choosing a broker, database, or hosted runtime.

## Implemented Flow

```text
Fixture candles
  -> CandleReplayEngine
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
- `SimpleBacktester` delegates candle replay to `CandleReplayEngine`, so historical replay uses the same market-data, feature, strategy, risk, execution, and portfolio path that future paper mode should reuse.
- Strategies are created through a registry. The CLI can select one strategy, override strategy params, compare multiple registered strategies, and slice candles with `--from`/`--to`.
- Registered strategies include moving-average crossover, buy-and-hold, momentum, mean reversion, RSI threshold, volatility breakout, trend-filtered momentum, and a scored context strategy.
- Registry metadata and ranked comparison summaries help review strategy families, default params, tags, returns, drawdown, profit factor, trade count, and data-quality warnings in one output.
- Backtest reports and CSV exports include structured logs, metrics, decision traces, and alert events captured from the replay loop.
- Local dashboard preparation is scoped to a read-only report viewer over generated JSON reports, with database/API/live dashboard work deferred.
- A dashboard report loader normalizes single and comparison JSON reports into a stable view model for the future local viewer.
- A Vite/React/Recharts dashboard scaffold renders sample report data through the dashboard view model.
- Alpaca IEX is the first chosen live-ingest provider for read-only equities latest bars over REST.
- Alpaca paper trading has a repeatable local validation checklist for latest bars, live-ops
  snapshots, one-shot paper cycles, duplicate buy-and-hold prevention, second-symbol validation, and
  flattening open paper exposure.
- A bounded paper trading coordinator can run small multi-symbol paper passes while reusing the
  existing Alpaca data, risk, gateway, strategy, and dashboard snapshot path.
- Coordinator restart state is persisted locally so pending-looking paper orders can block
  same-symbol exposure after a process restart until reconciled.
- Persisted coordinator orders are checked against the broker on restart, and terminal statuses clear
  local pending blockers.
- Partial-filled paper orders remain restart blockers with filled quantity and average fill price
  preserved in coordinator state.
- Paper coordinator entry sizing can target a per-symbol account allocation instead of only a fixed
  notional per run.
- Allocation sizing accepts explicit per-symbol weights and enforces a total allocation cap before
  the coordinator runs.

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
npm run backtest -- --strategy buy-and-hold
npm run backtest -- --compare-strategies moving-average-crossover,buy-and-hold
npm run backtest -- --compare-strategies moving-average-crossover,buy-and-hold,momentum,mean-reversion,rsi-threshold,volatility-breakout,trend-filtered-momentum,scored-context
npm run backtest -- --strategy-param shortWindow=2 --strategy-param longWindow=8
npm run backtest -- --from 1994-03-15 --to 1994-03-23
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
- Load user-selected JSON reports into the local Vite/React report viewer.
- Run a credentialed Alpaca IEX latest-bars smoke test and decide whether polling or WebSocket streaming should own the first paper-mode feed loop.
- Add strategy enable/disable controls only if the default registry becomes too broad for routine comparisons.
- Add allocation-aware intent mapping if buy-and-hold should target portfolio weight instead of the current fixed-notional order size.
- Add rate-limit handling, richer pending-order reconciliation, and multi-strategy allocation policy
  before any hosted always-on paper runtime.
- Add hosted observability adapters only after the deployment shape is chosen.
- Adapt `CandleReplayEngine` for paper-mode feeds when the first live data provider is selected.
- Add config validation before adding external feeds or exchange integrations.
