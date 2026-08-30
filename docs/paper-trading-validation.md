# Paper Trading Validation

This checklist validates the current Alpaca paper path before adding scheduling or hosted live
operation. It proves that credentials work, market data is reachable, one-shot strategy cycles can
place paper orders, duplicate buy-and-hold entries are avoided, and open paper exposure can be
flattened.

## Guardrails

- Keep `ALPACA_TRADING_MODE=paper`.
- Keep `LIVE_TRADING_ENABLED=false` and `LIVE_OPERATOR_CONFIRMED=false` while validating paper mode.
- Use small notionals such as `$25`.
- Keep `LIVE_KILL_SWITCH_ARMED=true`.
- Set `LIVE_STOP_AFTER_BREAK_EVEN=false` only when intentionally testing additional paper entries.
- Refresh `LIVE_OPS_DAY_STARTING_EQUITY` to the current paper account equity before a validation
  session if the break-even dashboard target should start from today.

## Local Commands

Load `.env` into the current PowerShell session first.

```powershell
Get-Content .env | Where-Object { $_ -match '^\s*[^#][^=]+=' } | ForEach-Object {
  $name, $value = $_ -split '=', 2
  [Environment]::SetEnvironmentVariable($name.Trim(), $value.Trim(), 'Process')
}
```

Run local checks.

```powershell
npm run typecheck
npm test
npm run typecheck:dashboard
npm run dashboard:build
```

Validate read-only Alpaca IEX data.

```powershell
npm run ingest:alpaca-iex -- SPY
```

Validate the combined read-only paper stack before placing any paper orders. This checks the paper
trading account, open positions, open orders, and latest IEX bars without submitting an order.

```powershell
npm run paper-trading:check -- --symbols SPY,AAPL
```

Write the dashboard snapshot from the paper account.

```powershell
npm run live-ops:snapshot -- --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Run one small paper cycle.

```powershell
npm run live-trading:cycle -- --symbol SPY --strategy buy-and-hold --notional 25 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Run the same command again. Expected result: `buy-and-hold` should see the existing SPY paper
position and skip a duplicate buy.

To validate more than one symbol without repeatedly increasing the same position, run a second small
cycle for another configured symbol.

```powershell
npm run live-trading:cycle -- --symbol AAPL --strategy buy-and-hold --notional 25 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Run a bounded multi-symbol coordinator pass when you want more than one manual one-shot cycle.

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL --strategy buy-and-hold --notional 25 --iterations 2 --interval-ms 60000 --max-executions-per-run 2 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Expected result: the first iteration can place small paper entries for symbols without existing
positions. Later iterations should skip duplicate `buy-and-hold` entries for symbols already held.
Use low iteration counts while validating behavior. The coordinator also checks Alpaca open orders
before each symbol cycle and skips a symbol when a pending order already exists.
The CLI also applies a run-level execution cap with `--max-executions-per-run`, defaulting to `5`.
Use `--dry-run` for a no-order coordinator preflight that still evaluates account, position,
open-order, market-data, session, stale-data, strategy, sizing, and risk plumbing. A useful preflight
should produce either an intentional skip reason or a `paperCycles` row with `status: "approved"`.
`--max-executions-per-run 0` is stricter: it blocks before strategy/risk evaluation and is best used
only when you want to validate reads and dashboard writing without checking whether a trade would
pass risk.

The coordinator bootstraps an Alpaca IEX 1-minute history for each symbol before the first latest-bar
poll and then keeps a rolling history capped at 100 candles by default. This allows multi-candle
strategies such as `moving-average-crossover` and `momentum` to evaluate on the first iteration when
enough completed bars are available. Keep allocation sizing and small order caps in place while
testing strategies that can buy and sell more than once.

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL --strategy moving-average-crossover --strategy-param shortWindow=2 --strategy-param longWindow=5 --strategy-param minConfidence=0.01 --sizing allocation --target-allocation-pct 0.0025 --max-order-notional 50 --max-position-notional 250 --max-executions-per-run 2 --iterations 5 --interval-ms 60000 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Use `--max-history-candles` to adjust the per-symbol rolling history cap for longer local paper
runs. Use repeatable `--strategy-param key=value` flags to tune the selected strategy without code
changes; numeric values are parsed as numbers.

Before removing `--dry-run`, run a one-symbol approved preflight with the same caps you intend to use
for the real paper order. This command validates that Alpaca paper credentials, market data, strategy
sizing, risk, dashboard snapshots, and restart state all work without submitting an order:

```powershell
npm run paper-trading:coordinator -- --symbols AAPL --strategy buy-and-hold --sizing allocation --target-allocation-pct 0.001 --max-order-notional 25 --max-position-notional 100 --max-executions-per-run 1 --max-notional-per-run 25 --iterations 1 --dry-run --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Expected result: `runSummary.executionCount` stays `0`, `executions` is empty, and the dashboard
snapshot includes a `paperCycles` row with `status: "approved"` when risk would allow the order. If
the row is `rejected` or `skipped`, inspect the `reason` before attempting a submit.

During regular market hours, remove only `--dry-run` to submit one capped paper order:

```powershell
npm run paper-trading:coordinator -- --symbols AAPL --strategy buy-and-hold --sizing allocation --target-allocation-pct 0.001 --max-order-notional 25 --max-position-notional 100 --max-executions-per-run 1 --max-notional-per-run 25 --iterations 1 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Expected result: `executionCount` is `1`, `submittedNotional` is about `$25`, open positions show the
new paper exposure, and `paperCycles` shows `status: "submitted"`. Keep the regular market-session
guard enabled for real paper submits unless you intentionally want to queue an order outside the
normal session.

By default, the coordinator starts with a regular `09:30` to `16:00` America/New_York session and
then validates the current date and session hours through Alpaca's read-only calendar endpoint.
Missing calendar dates are treated as closed days, early closes use the broker-provided close, and
calendar lookup failures stop the run. Explicit holidays remain available as an additional local
denylist:

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL --market-session-holidays 2026-07-03,2026-12-25 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

The coordinator writes transactional restart state, the pre-submit journal, and its local execution
lease to `reports/paper-trading.sqlite` by default.
That state records run counts and pending-looking orders. On the next run, persisted pending orders
are checked against Alpaca by order id. Filled, cancelled, or rejected orders are cleared from local
blocking state, but the affected symbol remains quarantined for that run so Alpaca positions have a
restart boundary in which to converge. Missing orders, failed lookups, and still-pending orders block
new exposure for the same symbol and record their reconciliation status. Partial fills stay blocked
and retain filled quantity and average fill price in the state file. State writes are validated,
flushed, and atomically replaced; malformed state stops the run instead of silently starting empty.
To use another SQLite state file:

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL --state reports/paper-state.sqlite --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Check the coordinator heartbeat from an independent scheduler or terminal. Set
`ALERT_WEBHOOK_URL` to an HTTPS receiver to deliver a critical stale-heartbeat alert:

```powershell
npm run operations:monitor -- --max-age-ms 120000
```

After at least five distinct bounded paper-trading days, evaluate the default operational soak
criteria. This is a reliability gate, not evidence of profitability:

```powershell
npm run paper-soak:audit
```

The opt-in integration file is skipped by the default suite. Enable only the read-only portion with
`RUN_ALPACA_READ_ONLY_INTEGRATION=true`. The tiny paper-order lifecycle additionally requires
`RUN_ALPACA_PAPER_ORDER_LIFECYCLE=true` and
`PAPER_ORDER_TEST_CONFIRMED=I_CONFIRM_PAPER_ACCOUNT_CHANGES`; running it changes the paper account.

To size entries by account allocation instead of fixed dollars per symbol, use allocation sizing:

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL --sizing allocation --target-allocation-pct 0.0025 --max-order-notional 50 --max-position-notional 250 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

With a `$100,000` paper account, `--target-allocation-pct 0.0025` targets roughly `$250` per symbol
and `--max-order-notional 50` limits each pass to a `$50` top-up.

For different per-symbol targets, pass explicit allocation weights. Any symbol without an explicit
weight uses `--target-allocation-pct`, and the full plan must stay under `--max-total-allocation-pct`.

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL,MSFT --sizing allocation --allocation-weights SPY=0.0025,AAPL=0.0015 --target-allocation-pct 0.001 --max-total-allocation-pct 0.01 --max-order-notional 50 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

By default, the coordinator skips symbols whose latest candle is more than 15 minutes old. For
after-hours dashboard validation, either run only `live-ops:snapshot` or intentionally disable the
market-session guard and pass a larger explicit stale-candle window:

```powershell
npm run paper-trading:coordinator -- --symbols SPY,AAPL --strategy buy-and-hold --notional 25 --iterations 1 --market-session off --max-candle-age-ms 86400000 --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Flatten open paper exposure when the validation session is done.

```powershell
npm run live-trading:flatten -- --out reports/live-ops-snapshot.json --history-dir reports/live-ops-history
```

Start or refresh the dashboard.

```powershell
npm run dashboard:dev
```

## Current Scope

The bot currently supports one-shot paper execution cycles and bounded multi-symbol coordinator
passes. The coordinator checks the configured market-session window, stale candles, and existing
pending orders before adding exposure. It also applies a run-level execution cap. It bootstraps
bounded historical IEX bars and adds latest bars during paper iterations so multi-candle strategies
can operate immediately. It persists a conservative restart state and blocks symbols with
unreconciled persisted pending orders. Terminal Alpaca order statuses clear persisted pending state
on the next run, while partial fills remain visible and blocking. The coordinator can use
fixed-notional sizing or per-symbol allocation sizing. Alpaca market-data and trading requests retry
transient `429` and `5xx` responses with bounded backoff, while broker/risk errors such as `403`
fail fast. It does not yet run an unattended continuous scheduler, rebalance a portfolio, or manage a
multi-strategy allocation plan.

The next automation step should add stronger supervision around pending orders, stale data,
rate-limit handling, restart recovery, and strategy allocation before any hosted always-on runtime.
