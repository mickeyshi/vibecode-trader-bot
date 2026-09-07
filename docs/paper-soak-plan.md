# Paper Soak Plan

This plan validates operational reliability, not profitability. It deliberately separates plumbing
validation from strategy research and keeps every automated coordinator invocation in dry-run mode.

## Initial scope

- Symbols: `AAPL` first, then `SPY,AAPL` after two clean sessions.
- Strategy: `buy-and-hold` as a deterministic execution-plumbing baseline, not an investment view.
- Sizing: allocation at `0.001`, capped at `$25` per order and `$100` per position.
- Run limits: one execution and `$25` submitted notional per bounded run.
- Guards: regular Alpaca calendar session, 15-minute candle age, 15-minute pending-order age, and
  `$5` account/position drift tolerance.
- Storage: single-host SQLite state under ignored `reports/`.

## Stages and evidence

1. Before each session, run the read-only paper connectivity check and recovery drill.
2. Run the supervised dry-run task for two sessions on `AAPL`; require approved or explainable hold
   decisions, fresh data, no lease conflict, no unresolved pending state, and a current heartbeat.
3. Repeat for at least three sessions with `SPY,AAPL` and unchanged configuration fingerprint.
4. Only with separate confirmation, run a bounded order-submitting paper session during regular
   market hours. Scheduling templates in this repository never perform this stage automatically.
5. Run `npm run paper-soak:audit` after five distinct coordinator days and retain the ignored JSON
   evidence locally.

Stop on stale data, calendar failure, circuit opening, heartbeat failure, configuration-fingerprint
drift, pending-order timeout, position drift, unexpected rejection, duplicate submission, or an
unreconciled restart. Follow `docs/paper-operations-runbook.md` before resuming.

Historical and synthetic backtests remain separate research evidence. Parameters must not be
promoted solely because they improve this soak or a single sample period.
