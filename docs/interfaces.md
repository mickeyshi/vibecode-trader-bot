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
- `portfolio/`: records orders, fills, positions, and account snapshots.
- `eval/`: reuses strategy and risk concepts for backtests and replay.

## Current Non-Decisions

The first pass does not choose a broker, database, scheduler, queue, frontend, or deployment pipeline. Those should be decided separately with cost, reliability, and operational tradeoffs documented in `docs/decisions/`.
