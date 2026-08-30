# 0007 Local Report Persistence

> Execution recovery was subsequently moved to SQLite by ADR 0009. This ADR still governs dashboard
> and backtest report persistence.

## Context

The local report viewer needs a data source for generated backtest reports. SQLite would provide
run indexing and queryable history, but the first viewer is scoped as a read-only local tool over
generated JSON reports.

The current report format already contains rich review data: strategy rankings, metadata, summary
metrics, equity curves, orders, fills, trades, risk rejections, data-quality warnings, logs,
metrics, decision traces, and alerts.

## Options Considered

1. Keep generated JSON reports as the local dashboard source.
2. Add a small SQLite store for run metadata and report paths.
3. Add a fuller SQLite persistence layer with normalized report tables.

## Decision

Keep generated JSON reports as the initial local dashboard data source. Do not add SQLite yet.

Add a report loader and dashboard-facing view model so the local viewer does not bind directly to
raw report internals. If report volume, run-history browsing, querying, or hosted access becomes
important, SQLite or another database can be introduced behind that boundary.

## Tradeoffs

This avoids adding database dependencies, migrations, schema versioning, and local file-management
decisions before the first viewer exists.

The tradeoff is that run discovery and indexing remain simple. A local viewer may load explicit
report files before it gains richer report browsing.

## Consequences

- JSON reports under `reports/` remain the first source of truth for dashboard review.
- The next implementation step is a report loader and dashboard view model.
- SQLite remains a future option, preferably starting with run metadata and report paths rather
  than a fully normalized domain database.
- Database-backed recovery, durable audit history, hosted dashboards, and multi-run query features
  remain medium-term persistence work.

## Recovery-State Clarification

Dashboard reports and execution recovery state have different safety requirements. Coordinator
recovery state remains local JSON for the current bounded paper workflow, but writes are validated,
flushed to a unique sibling file, and atomically renamed into place. Invalid state fails closed
instead of being treated as an empty account history.

Persisted pending orders record whether broker reconciliation confirmed the order as pending, could
not find it, or failed to complete the lookup. Missing and failed lookups remain blocking. When a
terminal broker status is observed, the symbol is quarantined until the next coordinator run so the
broker position view has a restart boundary in which to converge.

This does not make JSON production-grade persistence. It does not provide concurrent-writer safety,
a pre-submit idempotency journal, or a transaction spanning order intent and broker acceptance. A
new decision is required before selecting SQLite, a hosted relational database, or another durable
execution ledger.
