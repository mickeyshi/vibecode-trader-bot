# 0004 Local Report Viewer Scope

## Context

Backtest reports now contain enough structured output to support a useful review interface:
strategy metadata, comparison rankings, summary metrics, equity curves, orders, fills, trades,
risk rejections, data-quality warnings, logs, metrics, decision traces, and alerts.

The project has not yet chosen a database, API server, broker, live-trading runtime, or hosted
dashboard architecture. Building a broad dashboard before those decisions would couple the UI to
temporary assumptions.

## Options Considered

1. Build a local report viewer over generated JSON reports.
2. Add a backend API and persistent run database before building UI.
3. Design a live-trading operations dashboard now.

## Decision

Start with a local backtest report viewer that loads generated JSON reports from `reports/`.

The first viewer should be read-only and focused on post-run analysis:

- strategy comparison rankings and metadata
- headline return, drawdown, exposure, fee, trade, and data-quality metrics
- equity curve visualization
- trades, orders, fills, and risk rejection tables
- logs, metrics, decision traces, and alerts

The viewer should consume a dashboard-facing view model derived from `BacktestReport` rather than
binding components directly to every raw report field. This keeps the UI easier to change if report
storage later moves from files to a database or API.

## Tradeoffs

This keeps cost and operational complexity near zero, avoids premature persistence choices, and
creates a fast feedback loop for reviewing backtests.

The tradeoff is that the first dashboard will not provide multi-user access, durable indexed run
history, scheduled jobs, live trading controls, account monitoring, authentication, or hosted alert
delivery.

## Consequences

- JSON reports remain the initial source of truth for dashboard work.
- A small report loader/view-model layer should come before UI components.
- Live-trading dashboard features remain blocked on paper/live separation, kill switches,
  secret-management, exchange integration, restart recovery, and audit trail decisions.
- A database or API can be introduced later behind the view-model boundary if report volume,
  querying needs, or hosting requirements justify it.
