# 0009 SQLite Execution Recovery

## Context

Atomic JSON replacement cannot close the crash window between deciding to submit an order and
recording the broker response. The current single-host paper workflow also needs a single-runner
guard. The operator selected SQLite for the current deployment scope.

## Decision

Use Node's built-in SQLite API for coordinator recovery state, a pre-submit idempotency journal, and
an expiring single-owner coordinator lease. Write the journal entry with synchronous full durability
before invoking Alpaca. Pass the journal key as Alpaca's client order ID. On restart, reconcile any
prepared entry through client-order lookup and quarantine its symbol for the entire run.

Keep dashboard history as JSON. SQLite is an execution-safety boundary, not a general reporting
database. Keep the coordinator bounded; the lease expires after the calculated run window plus a
recovery margin.

## Tradeoffs

SQLite is transactional and operationally simple on one host, but it is not a multi-host consensus
system. Node 22 currently labels `node:sqlite` experimental, so upgrades require regression testing.
WAL files and the database must remain on a local filesystem and outside version control.

## Consequences

- A submission is durable before the broker HTTP call.
- Unknown submission outcomes block same-symbol exposure until client-ID reconciliation.
- Concurrent local coordinator processes fail closed on lease acquisition.
- Hosted multi-worker execution remains unsupported; moving there requires a new persistence and
  leader-election decision.
