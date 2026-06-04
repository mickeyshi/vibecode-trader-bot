# Spec Gaps & Roadmap

This list tracks known gaps between the current framework slice and a trading bot that is safe enough to evaluate seriously. Keep it current as tasks are completed or new risks appear.

## Current Baseline

- TypeScript project scaffold is in place.
- Interfaces exist for feeds, data, strategies, risk, execution, portfolio, and evaluation.
- Backtests can run against synthetic CSV/JSON fixtures and Stooq text exports.
- The first vertical slice uses in-memory stores, a moving-average strategy, a fixed-notional mapper, a basic risk engine, and a paper executor.
- Portfolio accounting now uses fee-aware cost basis, tracks realized/unrealized PnL, preserves average entry price on partial exits, guards against negative cash, and defaults to long-only behavior.
- Backtest reports now include rejected risk decisions for audit-oriented debugging.
- A small committed Stooq sample fixture is available for routine loader tests.
- The backtest CLI supports configurable fixture path, symbol, starting equity, fees, slippage, strategy windows, and full JSON report export.
- Paper execution can model spread, deterministic partial fills, and deterministic skipped fills.
- Backtest reports include richer metrics, CSV exports, and missing-data gap warnings.
- Backtest CLI settings can be loaded from a JSON config file, with explicit CLI flags taking precedence.
- Backtest metrics include closed-trade count, win/loss counts, win rate, gross profit/loss, and profit factor.
- Portfolio policy is long-only, cash-only, average-cost-only, with no borrow-cost or wash-sale model.
- Curated Stooq fixtures now include both a bond-style sample and a crypto-style sample.
- Backtest config files are runtime-validated for known keys and expected value shapes.
- Backtest reports include per-trade detail rows and CSV export for closed trades.
- Data-quality checks support market calendars: weekday sessions, crypto 24/7 sessions, and configured exchange holiday dates.
- Replay mode is represented by `CandleReplayEngine`, which runs historical candles through the same market-data, feature, strategy, risk, execution, and portfolio path used by backtests.
- Strategies are selected through a default registry, with CLI/config support for strategy params, comparison runs, and date-window slices.
- Off-the-shelf registered strategies now cover moving-average crossover, buy-and-hold, momentum, mean reversion, RSI threshold, volatility breakout, trend-filtered momentum, and scored context signals.

## Near-Term Gaps

- **CLI configuration:** move to a dedicated schema library if the file format grows beyond the current flat JSON shape.
- **Reporting:** add richer per-trade analytics only if the current closed-trade rows are not enough for review.
- **Allocation mapping:** add portfolio-weight-aware intent mapping only if fixed-notional sizing becomes too limiting for baseline comparisons.

## Medium-Term Gaps

- **Data validation:** add runtime schemas for fixture rows, exchange payloads, config, and environment variables.
- **Strategy lifecycle:** add metadata and result ranking if registry-based comparison needs more than strategy id, params, and summary metrics.
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
