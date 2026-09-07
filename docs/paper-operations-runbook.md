# Paper Operations Runbook

## Scope

This runbook covers one Windows host, Alpaca paper mode, SQLite recovery, supervised dry runs, and
bounded manually confirmed paper submissions. It does not authorize live-capital trading or an
unattended order-submitting schedule.

## Before Each Session

1. Confirm `main` is clean and CI is green.
2. Load `.env` and run `npm run paper-trading:check -- --symbols AAPL`.
3. Confirm paper mode, the paper endpoint, armed kill switch, current starting equity, and intended
   order, run, position, daily-loss, and exposure limits.
4. Run the coordinator with `--dry-run`; record the emitted configuration fingerprint.
5. Do not submit when calendar, freshness, reconciliation, drift, heartbeat, or risk blocks the run.

## Supervision

Preview the Windows tasks with `npm run paper-supervisor:preview`. Use `-Apply` on
`scripts/install-paper-supervisor.ps1` only to register the hard-coded dry-run and read-only monitor
tasks. The wrapper contains `--dry-run` directly. Any submit-capable schedule requires a new ADR and
explicit approval.

## Shutdown and Restart

Allow a bounded run to finish. Confirm the heartbeat is `completed`, then run
`npm run operations:monitor`. Before restart, confirm the SQLite lease is empty and the submission
journal has no unresolved entry. Never delete a lease or journal row to force a run.

## Pending or Timed-Out Orders

Stop new same-symbol exposure. Inspect the broker and client-order IDs. A timed-out, missing,
partially filled, or failed-lookup order remains blocking. Cancellation is an explicit external
change and must be separately confirmed. After a terminal status, retain the one-run quarantine and
verify the broker position.

## Position Drift

If account gross exposure differs from normalized positions beyond tolerance, stop new exposure.
Refresh account, positions, and open orders. Resolve partial fills, corporate actions, or stale
broker state before retrying. Do not increase tolerance merely to clear the gate.

## SQLite Recovery

The database and WAL/SHM siblings are ignored under `reports/`. Back them up only with no active
lease, and restore the siblings as one set. If opening or validation fails, preserve the files for
incident review and stop; never initialize empty state while broker orders might be unresolved.

## Heartbeat or Provider Failure

A stale/failed heartbeat, open circuit breaker, calendar failure, or repeated broker error blocks
operation. Check the process, network, Alpaca status, and latest snapshot. Restart only after the
cause is understood and lease/journal state is reconciled.

## Emergency Flattening

Flattening changes the paper account. Confirm the target account, positions, gates, and operator
intent before running `npm run live-trading:flatten`. Verify terminal orders and the final zero
position snapshot. Never automate flattening as a generic recovery response.

## Daily Close and Soak Evidence

Run the monitor and `npm run paper-soak:audit`. Record the configuration fingerprint, executions,
rejections, stale-data skips, timed-out orders, drift blocks, and incidents. The soak measures
operational reliability, not profitability.
