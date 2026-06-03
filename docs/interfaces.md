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

## Replay Boundary

`CandleReplayEngine` is the shared historical replay loop. It writes candles into the market
store, builds strategy context, maps signals to order intents, evaluates risk, routes approved
intents through paper execution, updates portfolio state, and records equity/risk/data-quality
outputs. `SimpleBacktester` wraps that replay result into return, drawdown, trade, and report
metrics.

## Evaluation Outputs

Backtest reports include summary returns, drawdown, final cash, position value, gross exposure,
realized/unrealized PnL, orders, fills, risk rejections, an equity curve, data-quality warnings,
aggregate closed-trade metrics, and per-trade detail rows. Export paths are intentionally local
files for now; choosing durable storage remains a separate persistence decision.

Data-quality warnings use a configured market calendar. The current built-in profiles are
`weekday` and `crypto-24-7`; exchange-specific holidays are supplied explicitly as dates.

## Portfolio Policy

The current account model is long-only and cash-only. It uses average-cost accounting, rejects
negative-cash or short-position fills, and intentionally does not model borrow costs, margin,
FIFO/LIFO tax lots, or wash-sale rules.

## Current Non-Decisions

The first pass does not choose a broker, database, scheduler, queue, frontend, or deployment pipeline. Those should be decided separately with cost, reliability, and operational tradeoffs documented in `docs/decisions/`.
