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
- Strategy registry entries include metadata, and comparison backtests include ranked summaries with the ranking formula in the output.
- Backtest reports include structured logs, point-in-time metrics, decision traces, and alert events, with optional observability hooks for forwarding alerts or telemetry.
- Local dashboard scope is documented: start with a read-only report viewer over generated JSON reports before adding a database, API, or hosted live-trading dashboard.
- Runtime configuration direction is documented: keep CLI parsing lightweight and use schema-backed validation at config, environment, and external data boundaries.
- Dashboard frontend direction is documented: use Vite, React, and Recharts for the initial local report viewer.
- Local dashboard data loading uses a JSON report loader and dashboard-facing view model, keeping SQLite/database work deferred.
- Local dashboard scaffold uses Vite, React, and Recharts with sample report data flowing through the dashboard view model.
- First live-ingest provider is documented as Alpaca IEX equities data, starting with read-only latest bars over REST.
- Paper Alpaca validation is documented in `docs/paper-trading-validation.md`, covering credentialed
  latest bars, live-ops snapshots, one-shot paper cycles, duplicate buy-and-hold prevention,
  second-symbol validation, and flattening.
- A bounded paper coordinator can run multi-symbol paper cycles through the same Alpaca data,
  strategy, risk, gateway, and dashboard snapshot path used by the one-shot cycle command.
- The paper coordinator persists conservative restart state with pending-looking orders and blocks
  same-symbol exposure until those persisted orders are reconciled.
- Persisted paper coordinator orders are reconciled against broker order lookup on restart; terminal
  broker statuses clear local pending blockers.
- Partial-filled broker orders remain pending blockers and carry filled quantity and average fill
  price into local restart state.
- Paper coordinator entries can use fixed-notional sizing or per-symbol allocation target sizing
  with max/min notional controls.
- Paper allocation sizing supports explicit per-symbol weights plus a total allocation cap.
- Alpaca market-data and trading clients retry transient `429` and `5xx` responses with bounded
  backoff while leaving non-retryable broker errors fail-fast.

## Near-Term Gaps

- **CLI configuration:** move to a dedicated schema library if the file format grows beyond the current flat JSON shape.
- **Reporting:** add richer per-trade analytics only if the current closed-trade rows are not enough for review.
- **Dashboard prep:** load user-selected JSON reports into the local Vite/React report viewer.
- **Allocation mapping:** add portfolio-weight-aware intent mapping only if fixed-notional sizing becomes too limiting for baseline comparisons.
- **Live ingest:** run a credentialed Alpaca IEX latest-bars smoke test and decide whether polling or WebSocket streaming should own the first paper-mode feed loop.
- **Paper supervision:** add richer pending-order reconciliation detail, market-session scheduling,
  and multi-strategy allocation policy before leaving a paper coordinator unattended.

## Medium-Term Gaps

- **Data validation:** add runtime schemas for fixture rows, exchange payloads, config, and environment variables.
- **Strategy lifecycle:** add enable/disable controls only if the default registry becomes too broad for routine comparisons.
- **Event/news inputs:** wire event feeds into both feature generation and risk controls.
- **Market data inputs:** evolve Alpaca IEX latest-bars ingest into a polling or WebSocket feed adapter with stale-data and rate-limit observability.
- **Persistence:** add SQLite or another database only when report volume, run history, recovery, or hosted access justify it.
- **Observability:** add hosted log/metric/alert adapters only after the deployment shape is chosen.

## Live-Trading Blockers

Do not implement live trading until these are addressed:

- Explicit paper/live mode separation.
- Kill switch and max-loss controls.
- Secret-management plan.
- Exchange sandbox integration tests.
- Duplicate-order prevention.
- Restart recovery for open orders and positions, including position drift after fills.
- Stale market-data and rate-limit handling.
- Pending-order reconciliation before placing new exposure.
- Audit trail for signals, risk decisions, orders, fills, and errors.

## Decision Notes Needed

- First news/event data provider.
- DigitalOcean deployment shape and monthly cost estimate.
