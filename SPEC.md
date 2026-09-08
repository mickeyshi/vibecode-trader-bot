# Trading Bot Specification

## Purpose

The project provides a small, inspectable framework for evaluating trading strategies and safely
progressing from historical replay to Alpaca paper trading. Its immediate goal is reliable paper
operation with auditable decisions and bounded risk. Live-capital trading is out of scope until the
blockers in this document are resolved and explicitly approved.

Success means the system can explain, reproduce, and constrain each decision. It does not mean a
strategy is profitable.

## Supported Scope

### Markets and Provider

- Current broker and market-data integration: Alpaca.
- Current market-data feed: latest US equity bars from Alpaca IEX REST.
- Current execution target: Alpaca paper trading.
- Internal models normalize candles, signals, intents, risk decisions, orders, fills, positions,
  account snapshots, logs, metrics, traces, and alerts.
- Alpaca requests retry bounded transient `429` and `5xx` responses; non-retryable errors fail fast.

Crypto, options, futures, short selling, margin, leverage, and multiple brokers are not currently
supported execution targets.

### Strategy and Sizing

The strategy registry includes:

- moving-average crossover;
- buy and hold;
- momentum;
- mean reversion;
- RSI threshold;
- volatility breakout;
- trend-filtered momentum;
- scored context.

Strategies emit buy, sell, or hold signals. Signals are mapped to orders using fixed-notional or
allocation-based sizing. Allocation sizing supports per-symbol weights, a default target allocation,
minimum and maximum order notionals, maximum position notional, and a total allocation cap.

The paper coordinator maintains bounded rolling candle history so multi-candle strategies can
evaluate repeated latest-bar polls. It records the last acted-on candle per symbol to prevent repeat
execution from an unchanged latest bar.

### Backtesting

Historical replay uses the same market-data, feature, strategy, risk, paper-execution, and portfolio
boundaries as the local backtester. Supported inputs include CSV, JSON, and Stooq text fixtures.

Configurable assumptions include starting equity, fees, slippage, spread, fill ratio, skipped fills,
date range, strategy parameters, market calendar, and explicit holidays. Reports include account
and return metrics, drawdown, orders, fills, closed trades, risk rejections, data-quality warnings,
equity points, logs, metrics, decision traces, and alerts. Reports can be written as JSON and CSV.

Strategy comparison produces a transparent review ranking. The ranking is not a recommendation or
proof of future performance.

A deterministic advanced-strategy validation runner compares volatility breakout, trend-filtered
momentum, and scored context against equal-exposure buy-and-hold across three synthetic regimes and
two friction levels. Its Markdown report validates mechanics and conditional effects only; it is
not historical out-of-sample evidence.

A separate research-only ETF relative-momentum simulator can download adjusted Alpaca IEX daily
bars and evaluate monthly, prior-close trend/momentum selection with volatility-targeted weights,
cash, transaction costs, parameter sensitivity, and rolling chronological evaluation. A dedicated
portfolio allocator returns bounded target weights without broker access. It is intentionally not
connected to paper execution because its first four unseen folds underperformed the benchmark and
selected unstable parameters.

### Paper Trading

The paper path supports:

- a read-only connectivity check for account, positions, open orders, and latest bars;
- one-shot strategy cycles;
- bounded multi-symbol and multi-iteration coordinator runs;
- fixed-notional and allocation sizing;
- per-order, per-position, gross-exposure, daily-loss, execution-count, and run-notional caps;
- regular-session and stale-candle gates;
- dry-run strategy and risk evaluation with no order submission;
- duplicate exposure and open-order checks;
- pending-order age escalation and broker/account position-drift gates;
- transactional SQLite pending-order, rolling-candle, and pre-submit journal state;
- an expiring single-host coordinator lease;
- restart reconciliation of terminal, pending, missing, failed-lookup, and partially filled orders;
- one-run symbol quarantine after terminal reconciliation so broker positions can converge;
- bounded retries for transient Alpaca failures;
- flattening through the same safety gateway;
- dashboard snapshots and local history records.

Paper runs are manually started and bounded. Windows Task Scheduler templates are available for a
hard-coded dry run and read-only heartbeat monitor, but there is no supported unattended order-
submitting production scheduler.

### Dashboard and Audit

The local Vite/React dashboard has Operations and Backtests views. Operations loads
`reports/live-ops-snapshot.json` when available and shows account state, break-even status,
readiness gates, controls, risk limits, paper-run summaries, paper decisions, positions, and orders.
It falls back to bundled sample data when no snapshot is available. Operations refreshes every 30
seconds and labels sample, current, and stale data explicitly.

The Backtests view currently uses bundled sample report data. Generated backtest report selection or
upload is not implemented. The dashboard is read-only and has no order-entry controls.

Local JSON files under `reports/` provide snapshots and timestamped run history. Multiple runs per
day are retained while break-even reporting selects the latest snapshot for each day. SQLite provides single-host
coordinator recovery state, the pre-submit journal, and the execution lease. All are ignored by Git;
SQLite is not a multi-host consensus system.

## Safety Requirements

The following are required invariants:

1. Paper mode must reject the known Alpaca live endpoint, and live mode must reject the paper
   endpoint.
2. Every executable intent must pass strategy mapping, the risk engine, and the trading safety
   gateway before broker submission.
3. Dry-run mode must execute no broker order-submission call.
4. Unknown or unresolved pending state must fail closed for new same-symbol exposure.
5. A partially filled order remains blocking until broker reconciliation reaches a terminal state.
6. A symbol must not execute twice from the same latest candle.
7. Run-level order count and notional caps must bound coordinator activity.
8. Stale data and closed sessions must block new entries unless an operator intentionally supplies an
   explicit alternative configuration.
9. Secrets and generated account reports must remain outside version control.
10. Tests and default commands must not change an external broker account.

`LIVE_TRADING_ENABLED`, `LIVE_OPERATOR_CONFIRMED`, `LIVE_KILL_SWITCH_ARMED`, daily-loss, gross
exposure, and break-even settings contribute to the live-operations readiness model. They do not by
themselves make live-capital trading supported or approved.

## Current Validation Status

The automated suite covers core replay, strategy registration and parameters, sizing, portfolio and
risk behavior, Alpaca payload normalization, retry behavior, connectivity checks, order execution,
session gates, safety-gateway decisions, coordinator dry runs and multi-trade sequences, restart
state, atomic state replacement, corrupt-state refusal, reconciliation failures, terminal-order
convergence quarantine, flattening, dashboard snapshots, audits, and view models.

Credentialed paper validation has demonstrated read-only account/data/calendar connectivity, a
one-symbol dry run that reached an approved risk decision without submitting an order, and a tiny
paper limit-order submit, lookup, and cancellation lifecycle. On 2026-09-08, a guarded `$25` AAPL
paper market order filled during the regular session; restart reconciliation quarantined the symbol,
the following run skipped because the position existed, and a final read-only check found no open
orders. This status is local and time-sensitive; rerun the checks before relying on it. Actual paper
fills, market conditions, and open account state must always be verified directly for the current
session.

## Live Readiness Progress

| Stage                                        | Status              | Current boundary                                                                                                                                                                                |
| -------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconciliation and durable state             | Implemented locally | SQLite stores validated coordinator state and a pre-submit idempotency journal; unknown outcomes reconcile by client ID and quarantine the symbol. Multi-host persistence remains out of scope. |
| Single-runner protection                     | Implemented locally | An expiring SQLite lease rejects concurrent coordinators on one host. Multi-host leader election remains out of scope.                                                                          |
| Authoritative calendars and data supervision | Implemented locally | Alpaca calendar validation, historical bootstrap, bounded network/HTTP retries, and a provider circuit breaker are active. Independent calendar verification and streaming remain.              |
| External monitoring                          | Ready to configure  | Atomic heartbeats, stale-heartbeat checks, HTTPS webhook delivery, and Windows dry-run/read-only supervisor templates exist; the operator must configure the receiver and register the tasks.   |
| Multi-day paper soak                         | Ready to run        | A deterministic acceptance audit evaluates recorded days, executions, rejections, stale data, and blocked snapshots; real elapsed paper days remain required.                                   |
| Tiny-capital live acceptance plan            | Pending approval    | Live-capital execution remains unsupported.                                                                                                                                                     |

## Known Gaps

### Highest Priority for Reliable Paper Operation

- **Real bar history:** the paper coordinator now bootstraps a bounded 1-minute history per symbol
  from Alpaca IEX before polling latest bars. Credentialed validation and provider-health visibility
  for that endpoint remain.
- **Exchange calendar:** paper runs now validate the current session date and early-close hours
  against Alpaca's read-only calendar endpoint and fail closed when the lookup fails. Independent
  calendar verification and corporate-action handling remain live-capital blockers.
- **Order lifecycle:** transactional state, conservative persisted-order reconciliation, a
  pre-submit idempotency journal, client-ID recovery, pending-order timeout escalation, and an
  account-versus-position drift gate are implemented. Add reviewed cancel/replace behavior, fills
  arriving between polls, and lot-level authoritative reconciliation.
- **Continuous supervision:** local single-runner leases, atomic heartbeats, a monitor command, and
  HTTPS webhook alerts exist. A separately selected external process manager and scheduler remain.
- **Durable state:** SQLite transactionally stores recovery state and pre-submit journal entries for
  a single host. Hosted or concurrent workers require a different persistence/consensus boundary.
- **Streaming and rate visibility:** bounded retry now includes network failures and an outage
  circuit breaker. WebSocket streaming and rate-limit dashboard visibility remain.
- **Alert delivery:** a generic HTTPS webhook sink and stale-heartbeat monitor exist. External
  scheduling, webhook configuration, and delivery escalation procedures remain operational tasks.
- **End-to-end sandbox test:** default automation mocks Alpaca. Opt-in credentialed read-only and
  separately confirmed tiny paper-order lifecycle suites are implemented and have passed locally;
  they remain excluded from credential-free CI by design.

### Strategy Evaluation Gaps

- No historical Alpaca bootstrap shared by backtest and paper modes.
- Rolling parameter selection exists for the ETF relative-momentum candidate, but only four annual
  unseen folds are available and the first result failed promotion criteria.
- No benchmark comparison, risk-adjusted return suite, turnover analysis, or exposure-by-time
  analysis beyond current report metrics.
- No realistic liquidity, volume participation, latency, gap, halt, or order-book model.
- No corporate-action, delisting, survivorship-bias, or point-in-time universe handling.
- No multi-strategy capital allocator, correlation limit, sector concentration limit, or portfolio
  rebalance policy.
- No taxes, wash sales, FIFO/LIFO lots, dividends, borrow costs, or short inventory model.

### Dashboard and Operations Gaps

- Backtest report selection/loading is not wired into the UI.
- Operations data refreshes by polling rather than streaming.
- No authentication, authorization, multi-user controls, or hosted access model.
- No interactive order controls by design; any future control must require a separate safety review.
- No database-backed run search, retention policy, reconciliation timeline, or downloadable incident
  bundle.

### Configuration and Security Gaps

- Environment and coordinator CLI parsing use hand-written validation rather than a shared runtime
  schema.
- There is no production secret-manager integration or key-rotation procedure.
- Broker and market-data HTTP errors pass through a conservative external-error sanitizer; a formal
  policy and broader structured-field allowlist remain.
- Coordinator output records a SHA-256 fingerprint plus the non-secret effective configuration and
  risk limits.
- GitHub Actions enforces tests, backend and dashboard types, lint, formatting, and builds on Linux
  and Windows without loading credentials or contacting Alpaca. Branch protection must still be
  enabled after a GitHub remote is configured.

### Live-Capital Blockers

Live-capital execution remains unsupported until, at minimum, the following are designed, tested,
documented, and explicitly approved:

- independent live kill switch with tested fail-closed behavior;
- durable broker/order/position reconciliation across crashes and concurrent processes;
- authoritative market calendar and corporate-action handling;
- production secret storage, rotation, and access control;
- external monitoring, heartbeat, paging, and incident procedures;
- deployment architecture with single-runner guarantees and rollback behavior;
- automated paper soak period with defined success and failure thresholds;
- live-specific max loss, max position, max gross exposure, symbol allowlist, and staged notional
  rollout;
- broker sandbox integration tests plus a reviewed tiny-order live acceptance plan;
- legal, tax, data licensing, and account-permission review appropriate to the operator.

## Recommended Development Order

1. Review and register the provided dry-run supervisor and independent heartbeat-monitor schedule.
2. Configure HTTPS alert delivery and document incident ownership and response procedures.
3. Run bounded paper sessions across multiple market days until explicit soak criteria pass.
4. Add independent calendar verification, position-drift reconciliation, and order timeouts.
5. Prepare a separately reviewed tiny-capital live acceptance plan only after soak criteria pass.
6. Continue dashboard report loading and strategy research without allowing those tasks to bypass
   the live-readiness order above.

## Non-Goals

- Promising returns or optimizing only for break-even on a single trade.
- Automatically enabling live trading from setup or dashboard actions.
- Hosting the dashboard or coordinator before operational ownership is defined.
- Supporting every asset class or broker through premature abstraction.
- Treating local JSON state as production-grade persistence.

## Related Documents

- `README.md`: setup, checks, paper preflight, dashboard, and backtest quick start.
- `AGENTS.md`: engineering, safety, testing, and handoff practices.
- `docs/paper-trading-validation.md`: detailed Alpaca paper validation procedure.
- `docs/paper-operations-runbook.md`: supervision, recovery, escalation, and soak operations.
- `docs/paper-soak-plan.md`: initial symbols, caps, stages, and acceptance evidence.
- `docs/etf-momentum-research.md`: real-data ETF rotation method, results, and promotion gates.
- `docs/interfaces.md`: architectural boundaries and normalized interfaces.
- `docs/vertical-slice.md`: historical replay implementation notes.
- `docs/spec-gaps.md`: legacy detailed roadmap; new gaps should also be reflected here or migrated
  into this specification.
- `docs/decisions/`: architecture decision records.
