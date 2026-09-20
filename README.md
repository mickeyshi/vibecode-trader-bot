# Trading Bot Test

A TypeScript/Node.js trading framework for backtesting strategies, validating Alpaca market data,
and running small, guarded Alpaca paper-trading cycles. The project is intentionally paper-first:
backtest results and paper fills are evaluation evidence, not proof of profitability or readiness for
live capital.

## Requirements

- Node.js 22 or newer
- npm
- An Alpaca account with paper-trading API credentials for broker validation
- Alpaca market-data credentials for IEX latest bars
- PowerShell for the documented local environment-loading workflow

Confirm the local versions:

```powershell
node --version
npm --version
```

## First-Time Setup

Install the locked dependency set:

```powershell
npm ci
```

Create a local `.env` from `.env.example`, then fill in the Alpaca paper and market-data values.
Never commit `.env`. The repository ignores `.env` and generated reports while allowing the
placeholder-only `.env.example` to be tracked.

Keep these safety settings while validating the project:

```dotenv
ALPACA_TRADING_MODE=paper
ALPACA_TRADING_BASE_URL=https://paper-api.alpaca.markets
LIVE_TRADING_ENABLED=false
LIVE_OPERATOR_CONFIRMED=false
LIVE_KILL_SWITCH_ARMED=true
```

The application does not automatically load `.env`. Load it into the current PowerShell process
before running commands that use Alpaca or live-operations configuration:

```powershell
.\update-env.ps1
```

You can also load it without the helper:

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]+=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}
```

## Verify the Repository

Run the complete local quality gate:

```powershell
npm test
npm run typecheck
npm run typecheck:dashboard
npm run lint
npm run format:check
npm run build
npm run dashboard:build
```

The test suite uses mocks and local fixtures. It should not submit broker orders.

GitHub Actions runs the same credential-free gate on Linux and Windows for pushes and pull requests.
The workflow uploads backend and dashboard build output for review, but it does not deploy, load
secrets, call Alpaca, schedule the coordinator, or submit orders. Credentialed integration checks
remain explicit local operations.

## Validate Alpaca Paper Connectivity

Start with the combined read-only check. It reads the paper account, positions, open orders, and
latest IEX bars without submitting an order:

```powershell
npm run paper-trading:check -- --symbols SPY,AAPL
```

To validate only market data:

```powershell
npm run ingest:alpaca-iex -- SPY
```

Stale-bar warnings are expected outside regular market hours. Do not disable the market-session or
stale-data guards merely to force a trade.

## Run a Safe Paper Preflight

Use a one-symbol dry run with small caps. This evaluates account state, market data, strategy,
sizing, risk, restart state, and dashboard output without calling Alpaca's order-submission API:

```powershell
npm run paper-trading:coordinator -- --symbols AAPL --strategy buy-and-hold --sizing allocation --target-allocation-pct 0.001 --max-order-notional 25 --max-position-notional 100 --max-executions-per-run 1 --max-notional-per-run 25 --iterations 1 --dry-run --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

A successful preflight has an `approved` paper-cycle row, no executions, and
`runSummary.dryRun: true`. A `skipped` result can be correct when the broker calendar says the market is closed, the latest
bar is stale, an order is pending, the position already satisfies the strategy, or the candle has
already been acted on. Investigate the recorded reason before changing a guard.

Removing `--dry-run` changes external paper-account state. Do that only as a deliberate validation
during regular market hours, keeping the one-order and notional caps in place. The fuller procedure,
including duplicate prevention, restart reconciliation, allocation sizing, and flattening, is in
[`docs/paper-trading-validation.md`](docs/paper-trading-validation.md).

## Dashboard

Generate or refresh the paper-account snapshot:

```powershell
npm run live-ops:snapshot -- --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Start the local dashboard:

```powershell
npm run dashboard:dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The Operations tab reads
`reports/live-ops-snapshot.json` when available and falls back to sample data. The Backtests tab is
currently backed by bundled sample report data; loading a user-selected generated report is still a
known gap.

The dashboard is an installable, read-only PWA designed as the first Android reporting client. Build
and test the production shell locally with:

```powershell
npm run dashboard:build
npm run dashboard:preview -- --host 127.0.0.1
```

For a production-like local check, build and run the dependency-free read-only server. It exposes
`/health/live` and `/health/ready`, serves the PWA and report APIs, and defaults to loopback:

```powershell
npm run dashboard:build
npm run dashboard:serve
```

The production server deliberately refuses `0.0.0.0` and other non-loopback binds until the
authentication boundary proposed in ADR 0012 is selected and implemented. Do not use the Vite
preview server as public hosting.

Before packaging a paper-only deployment, load its runtime environment and run the fail-closed
preflight. It verifies paper mode and endpoint separation, live-disabled controls, the armed kill
switch, credential presence, the built PWA, and writable persistent reporting storage. Its output
never includes credential values.

```powershell
npm run deployment:preflight
```

Create a consistent SQLite/history backup and immediately prove that it can be restored and
validated in an isolated temporary directory. The command refuses to run while a coordinator lease
is active and never overwrites an existing backup directory:

```powershell
npm run paper-backup:drill
```

The app displays connection, snapshot freshness, last-sync state, and a bounded run-history equity
timeline from validated snapshots under `reports/live-ops-history`. Its service worker caches the
application shell but deliberately excludes live account and history APIs. Android installation from a
different device requires an HTTPS-hosted endpoint; do not expose the local report server to a
network or the internet until authentication, authorization, TLS, and deployment ownership have
been selected and reviewed.

The Backtests tab indexes valid JSON backtest reports under ignored `reports/` and lets the operator
switch reports without rebuilding the UI. Its local API returns normalized dashboard view models,
not raw files, and skips malformed JSON, operational snapshots, and configuration artifacts.

The Research tab reads `reports/etf-momentum-research.json`, generated by
`npm run research:etf-momentum`. It shows the rejected ETF candidate beside its benchmark, plus
calendar-year, symbol, and point-in-time regime attribution. The report and API are read-only and
do not promote the candidate into the coordinator.

## Backtesting

Run the default fixture and strategy:

```powershell
npm run backtest
```

Useful variants:

```powershell
npm run backtest -- --strategy buy-and-hold
npm run backtest -- --compare-strategies moving-average-crossover,momentum,mean-reversion
npm run backtest -- --config backtest.config.example.json
npm run backtest -- --report reports/backtest.json --report-csv-dir reports/backtest-csv
npm run backtest -- --help
```

Generate the reproducible synthetic-regime report with `npm run validate:advanced-strategies`.
It compares equal target allocations under base and stressed friction and writes
`reports/advanced-strategy-validation.md` by default. Pass a path after `--` to write elsewhere.
This is framework validation rather than evidence of live profitability.

Backtests support CSV, JSON, and Stooq text fixtures; fees, spread, slippage, partial and skipped
fills; date windows; explicit market holidays; strategy parameters; comparison ranking; and JSON or
CSV audit output. Assumptions must stay visible whenever results are reviewed.

## Project Layout

- `src/feeds/`: normalized market-data adapters and Alpaca retry behavior
- `src/strategies/`: deterministic signal generation and intent sizing
- `src/risk/`: pre-trade limits and account-risk checks
- `src/execution/`: broker adapters, safety gateway, paper coordinator, and recovery state
- `src/portfolio/`: local portfolio accounting used by replay and tests
- `src/eval/`: fixture replay, backtesting, metrics, and exports
- `src/dashboard/`: live-operations snapshots, audits, view models, and the React app
- `src/observability/`: structured logs, metrics, traces, and alerts
- `tests/`: unit, integration-style, simulation, and mocked broker tests
- `docs/decisions/`: architecture decision records
- `reports/`: generated local output; ignored by Git

See [`SPEC.md`](SPEC.md) for current behavior and gaps, and [`AGENTS.md`](AGENTS.md) for development
and safety practices.
