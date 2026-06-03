# Spec Gaps & Roadmap

This list tracks known gaps between the current framework slice and a trading bot that is safe enough to evaluate seriously. Keep it current as tasks are completed or new risks appear.

## Current Baseline

- TypeScript project scaffold is in place.
- Interfaces exist for feeds, data, strategies, risk, execution, portfolio, and evaluation.
- Backtests can run against synthetic CSV/JSON fixtures and Stooq text exports.
- The first vertical slice uses in-memory stores, a moving-average strategy, a fixed-notional mapper, a basic risk engine, and a paper executor.
- Portfolio accounting now tracks realized PnL for position reductions, preserves average entry price on partial exits, and defaults to long-only behavior.
- Backtest reports now include rejected risk decisions for audit-oriented debugging.
- A small committed Stooq sample fixture is available for routine loader tests.
- The backtest CLI supports configurable fixture path, symbol, starting equity, fees, slippage, strategy windows, and full JSON report export.

## Near-Term Gaps

- **Portfolio accounting:** add deeper short-position support only after an explicit shorting/leverage design decision. Current behavior is long-only by default.
- **Risk controls:** improve fee-aware buying-power checks and decide whether leverage should be completely disabled or configurable by strategy/account type.
- **Fixture selection:** add one or two more curated samples only if they cover meaningfully different formats or edge cases.
- **Backtest realism:** model spread, partial fills, skipped fills, market holidays, and missing data.
- **CLI configuration:** add config-file support only if repeated experiments make long CLI commands painful.
- **Reporting:** add CSV exports and richer performance metrics after the core accounting model stabilizes.

## Medium-Term Gaps

- **Replay mode:** run historical data through the same event loop planned for paper trading.
- **Data validation:** add runtime schemas for fixture rows, exchange payloads, config, and environment variables.
- **Strategy lifecycle:** define how strategies are registered, parameterized, enabled, disabled, and compared.
- **Event/news inputs:** wire event feeds into both feature generation and risk controls.
- **Persistence:** decide when to move beyond in-memory stores and document the database tradeoff.
- **Observability:** add structured logs, metrics, decision traces, and alert hooks.

## Live-Trading Blockers

Do not implement live trading until these are addressed:

- Explicit paper/live mode separation.
- Kill switch and max-loss controls.
- Secret-management plan.
- Exchange sandbox integration tests.
- Duplicate-order prevention.
- Restart recovery for open orders and positions.
- Audit trail for signals, risk decisions, orders, fills, and errors.

## Decision Notes Needed

- Runtime configuration approach.
- Local persistence versus database.
- First exchange or broker integration.
- First market/news data provider.
- DigitalOcean deployment shape and monthly cost estimate.
