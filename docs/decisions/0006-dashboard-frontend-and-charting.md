# 0006 Dashboard Frontend and Charting

## Context

ADR 0004 scopes the first dashboard as a local, read-only backtest report viewer over generated
JSON reports. The viewer needs a frontend stack that can render comparison rankings, summary
metrics, equity curves, trades, orders, fills, risk rejections, logs, metrics, decision traces, and
alerts without forcing an early backend or database decision.

The repository is already TypeScript-based, and the dashboard should share typed report/view-model
definitions with the rest of the project where practical.

## Options Considered

1. Static HTML and TypeScript with minimal dependencies.
2. Vite and React with a React charting library.
3. Vite and Svelte with a Svelte charting library.
4. Backend-served dashboard with an API and report index.

## Decision

Use Vite and React for the initial local report viewer. Use Recharts for the first charting layer.

The first implementation should remain local and read-only. It should consume a dashboard-facing
view model derived from `BacktestReport` rather than binding components directly to raw report
fields.

The first viewer should not add a backend API, authentication, scheduled jobs, hosted deployment, or
live-trading controls. Those remain separate decisions.

## Tradeoffs

Vite and React add frontend dependencies, but they provide a fast development loop, familiar
component structure, and broad chart/table ecosystem. Recharts is sufficient for initial equity
curves, comparison charts, and simple metric visualizations.

Recharts is not the highest-performance option for very dense time-series data. If report volume or
chart density grows, the charting decision can be revisited for Apache ECharts, uPlot, or another
library.

## Consequences

- Add the dashboard as a local frontend app when implementation begins.
- Keep dashboard data loading behind a report-loader/view-model layer.
- Start with generated JSON reports as the data source.
- Defer backend API, persistent run indexing, hosted dashboard features, and live-trading controls.
