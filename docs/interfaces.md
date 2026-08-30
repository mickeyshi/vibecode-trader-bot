# First-Pass Interfaces

These interfaces define the first architectural boundary for the trading bot. They are intentionally small: the goal is to clarify responsibilities before choosing a runtime, exchange SDK, database, queue, or hosting-specific service.

## Runtime Flow

```text
MarketFeed/EventFeed
  -> MarketDataStore/EventStore
  -> FeatureBuilder
  -> Strategy
  -> SignalToIntentMapper
  -> RiskEngine
  -> OrderExecutor
  -> PortfolioStore
```

## Key Boundaries

- `feeds/`: connects to live market and event providers, then emits normalized events.
- `data/`: stores ticks, candles, news/events, and builds strategy-ready context.
- `strategies/`: reads context and emits buy, sell, or hold signals.
- `risk/`: approves, rejects, or modifies order intent before execution.
- `execution/`: implements paper or live order placement.
- `portfolio/`: records orders, fills, positions, fee-aware cost basis, and account snapshots.
- `eval/`: reuses strategy and risk concepts for backtests and candle replay.

## Market Data Ingest

The first live-ingest provider is Alpaca IEX equities data. The initial adapter uses the read-only
latest-bars REST endpoint, requests the `iex` feed explicitly, and normalizes provider payloads into
internal `Candle` values. This is market-data plumbing only; it does not enable order placement or
live trading.

## Replay Boundary

`CandleReplayEngine` is the shared historical replay loop. It writes candles into the market
store, builds strategy context, maps signals to order intents, evaluates risk, routes approved
intents through paper execution, updates portfolio state, and records equity/risk/data-quality
outputs. `SimpleBacktester` wraps that replay result into return, drawdown, trade, and report
metrics.

## Strategy Lifecycle

Strategies are created through a registry rather than hardcoded in the runner. The default
registry currently includes `moving-average-crossover`, `buy-and-hold`, `momentum`,
`mean-reversion`, `rsi-threshold`, `volatility-breakout`, `trend-filtered-momentum`, and
`scored-context`. Backtest config can select one strategy with params, compare several registered
strategies, and filter candles by date range for short-term versus long-term evaluation. Registry
metadata captures each strategy's display name, category, default params, and tags so comparison
reports can be read without cross-referencing source files.

## Evaluation Outputs

Backtest reports include summary returns, drawdown, final cash, position value, gross exposure,
realized/unrealized PnL, orders, fills, risk rejections, an equity curve, data-quality warnings,
aggregate closed-trade metrics, and per-trade detail rows. Export paths are intentionally local
files for now; choosing durable storage remains a separate persistence decision.

Comparison runs add a ranked summary using a transparent score based on return, drawdown, capped
profit factor, closed-trade presence, and data-quality warnings. The ranking is a review aid for
baseline comparisons, not evidence of live-trading profitability.

## Observability

Backtest reports include structured logs, point-in-time metrics, decision traces, and alert events.
`CandleReplayEngine` collects these records through an in-memory sink by default and can fan them
out to an optional `ObservabilitySink` hook for future paper-mode or hosted monitoring adapters.
Decision traces record the signal, mapped intent, risk decision, order result, fill count, and
equity for each evaluated candle.

Data-quality warnings use a configured market calendar. The current built-in profiles are
`weekday` and `crypto-24-7`; exchange-specific holidays are supplied explicitly as dates.

## Portfolio Policy

The current account model is long-only and cash-only. It uses average-cost accounting, rejects
negative-cash or short-position fills, and intentionally does not model borrow costs, margin,
FIFO/LIFO tax lots, or wash-sale rules.

## Current Non-Decisions

The project now uses Alpaca for paper execution, SQLite for single-host recovery state, React/Vite
for the local dashboard, and GitHub Actions for credential-free validation. A scheduler, hosted
runtime, queue, and live-capital deployment pipeline remain separate decisions requiring documented
cost, reliability, and operational tradeoffs.
