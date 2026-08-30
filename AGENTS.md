# Repository Guidance

## Mission and Current State

This repository is a paper-first TypeScript trading framework. It currently supports fixture-based
backtests, Alpaca IEX latest-bar reads, read-only Alpaca paper-account checks, guarded one-shot and
bounded coordinator cycles, local restart state, and a read-only operations dashboard.

Treat it as an evaluation and controls project, not a proven profitable bot. Do not describe a
backtest, dry run, or paper fill as evidence that a strategy will make money with live capital.

`SPEC.md` is the canonical product and gap summary. Detailed operating steps live in
`docs/paper-trading-validation.md`; architecture choices live in `docs/decisions/`. Update the
relevant document when behavior changes.

## Architecture Boundaries

- `src/core/`: normalized shared trading types.
- `src/feeds/`: external market-data clients, normalization, and retry policy.
- `src/data/`: market/event stores and feature building.
- `src/strategies/`: deterministic signals, parameter parsing, and intent sizing.
- `src/risk/`: pre-trade limits. Risk code must not place orders.
- `src/execution/`: trading gateways, broker adapters, coordinator logic, and recovery state.
- `src/portfolio/`: portfolio accounting and position state.
- `src/eval/`: replay, backtests, reports, and comparison metrics.
- `src/dashboard/`: snapshot generation, audits, view models, and the local React UI.
- `src/observability/`: normalized logs, metrics, decision traces, and alerts.
- `tests/`: unit, integration-style, and simulation coverage using fixtures or mocks.

Keep normalized internal types at provider boundaries. Do not leak raw Alpaca payloads through
strategy, risk, or dashboard code. Keep strategies deterministic where practical and isolate I/O in
feeds, execution, persistence, and reporting adapters.

## Financial Safety Rules

- Default every example and test to local simulation, read-only access, paper mode, or `--dry-run`.
- Never submit an order, cancel an order, or flatten a broker account without explicit user intent.
- Treat paper orders as external state changes even though they do not use live capital.
- Never enable live mode, alter broker endpoints, disable a kill switch, turn off session/stale-data
  guards, increase notional limits, or weaken risk checks without explicit user approval.
- Keep paper and live endpoint validation fail-closed. A mode/endpoint mismatch must be rejected.
- Preserve the execution path: signal -> intent -> risk -> safety gateway -> executor -> audit.
- Every order path needs bounded notional, position, exposure, daily-loss, and execution-count limits.
- Order submission must have duplicate-order prevention, pending-order reconciliation, and stable
  client order identifiers.
- Unknown, stale, partial, or unreconciled broker state should block new same-symbol exposure.
- Keep a dry-run path that exercises strategy and risk without invoking broker submission.
- Live-trading commands must be explicit, clearly named, and never part of a default setup or test
  command.

Ask before decisions that materially alter broker choice, live-trading behavior, financial risk,
secret management, scheduling, deployment, data providers, persistent storage, or operating cost.
Document major decisions with a short ADR covering context, options, tradeoffs, and the decision.

## Secrets and Local State

Never print, commit, copy into documentation, or expose API keys, secret keys, tokens, wallet data,
or `.env` values. Read `.env.example` for names and defaults; inspect `.env` only when a specific
diagnostic requires it, and never echo its values.

Keep these ignored: `.env`, generated `reports/`, build output, coverage, logs, and downloaded data.
Only `.env.example` may be tracked, and it must contain placeholders. Do not add credential helper
files such as `*.pwd` or scripts with embedded secrets. Environment-loading helpers may contain
variable-loading logic only.

## Development Workflow

Before editing:

1. Read the nearest implementation, tests, `SPEC.md`, and relevant ADRs.
2. Check `git status --short`; the worktree may contain user changes.
3. Preserve unrelated modifications and work with overlapping changes instead of reverting them.
4. Confirm whether the task is read-only, local code work, or an external broker-state change.

Prefer small explicit components and existing interfaces over new frameworks or broad abstractions.
Use typed parsers or schemas at configuration and external-data boundaries. Keep money comparisons
tolerant of floating-point boundary noise, while rejecting meaningful cap overages. Use UTC ISO
timestamps internally and explicit market time zones at session boundaries.

Use `rg` and `rg --files` for discovery. Use `apply_patch` for manual edits. Avoid destructive Git
commands and do not clean, reset, or overwrite unrelated work.

## Verification Standard

Run checks in proportion to the change. The full local gate is:

```powershell
npm test
npm run typecheck
npm run typecheck:dashboard
npm run lint
npm run format:check
npm run build
npm run dashboard:build
```

Tests must not require real credentials or submit broker orders. Mock HTTP boundaries and use fake
clocks where time affects sessions, stale candles, retries, or IDs. Add focused regression coverage
for a bug before or with its fix.

Money-moving behavior needs tests for:

- exact limit boundaries and genuine overages;
- buying power, daily loss, gross exposure, order, position, and run-level caps;
- duplicate and same-candle prevention;
- pending, partial, terminal, missing, and failed order reconciliation;
- transient retry limits and non-retryable broker failures;
- restart recovery and corrupt or absent state;
- dry-run proving that `placeOrder` is not called;
- paper/live endpoint separation;
- market-session and stale-data gates;
- buy, sell, hold, rejected, skipped, and multi-trade sequences.

Credentialed Alpaca checks are separate manual integration validation. Start with
`paper-trading:check`, then use a one-symbol coordinator `--dry-run`. Request confirmation before a
command that removes `--dry-run` or otherwise changes the broker account.

## Backtest and Strategy Practices

Backtests must state data source, sample period, fees, slippage, spread, fill assumptions, and market
calendar assumptions. Avoid look-ahead bias, survivorship bias, accidental parameter fitting, and
ranking strategies solely by return. Prefer walk-forward or out-of-sample evaluation before
promoting a strategy to a paper session.

Strategy changes should preserve the same signal and intent interfaces used by replay and paper
execution. Add deterministic edge-case tests and comparison evidence. Strategy code must not bypass
risk or call a broker directly.

## Pull Requests and Handoffs

Use concise imperative commits. A pull request or handoff should state:

- behavioral summary and affected execution path;
- tests and manual checks run;
- financial and operational risk impact;
- environment or configuration changes;
- dashboard screenshots or sanitized logs when UI or operations behavior changes;
- the related ADR for architecture changes.

Never include credentials, raw `.env` output, or account identifiers in commits, logs, screenshots,
or chat summaries.
