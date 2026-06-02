# Repository Guidelines

## Project Structure & Module Organization

This repository is for a small trading bot. Keep the codebase organized so strategy logic, market integrations, and execution risk controls stay easy to inspect.

- `src/` for application code.
- `src/strategies/` for strategy modules and signal generation.
- `src/exchanges/` for broker or exchange API clients.
- `src/risk/` for position sizing, limits, stop rules, and circuit breakers.
- `src/data/` for market-data ingestion, normalization, and caching.
- `tests/` for unit, integration, and simulation tests.
- `docs/` for architecture notes, platform comparisons, and design decisions.
- `scripts/` for local utilities, backfills, and maintenance tasks.

Do not mix live trading execution with research-only notebooks or one-off scripts.

## Architecture & Decision Visibility

Favor small, explicit components over clever abstractions. Document major design decisions in `docs/decisions/` using short ADR-style notes that explain context, options considered, tradeoffs, and the chosen path.

Ask the user before making large-scale decisions, including exchange selection, cloud provider, database choice, deployment model, scheduling architecture, live-trading behavior, secret-management approach, or any change that increases operating cost or financial risk.

When proposing an externally hosted service, include drawbacks and rough monthly budget estimates. Cover at least compute, database/storage, logging/monitoring, data feeds, and exchange or broker API costs where relevant.

Assume DigitalOcean App Platform as the initial hosted platform unless the user changes direction. Periodically reevaluate whether hosting complexity, uptime needs, scaling, background-worker behavior, observability, or cost justify migration to a more robust platform.

## Build, Test, and Development Commands

This project uses TypeScript on Node.js. Install dependencies before running local checks:

- `npm install`: install project tooling and dependencies.
- `npm run typecheck`: run the TypeScript compiler without emitting files.
- `npm test`: run the Vitest test suite.
- `npm run lint`: run ESLint static checks.
- `npm run format:check`: verify Prettier formatting.
- `npm run build`: compile source into `dist/`.
- `npm run backtest`: run the backtest entry point once implemented.

Live trading commands must be clearly named, require explicit configuration, and never be the default local command.

## Coding Style & Naming Conventions

Use clear names that expose trading intent: `meanReversionStrategy`, `maxPositionSize`, `paperOrderExecutor`, `binanceMarketDataClient`. Keep strategy code deterministic where practical and isolate side effects in exchange, persistence, and notification adapters.

Prefer typed interfaces or schemas for orders, fills, candles, balances, and positions. Avoid passing raw exchange payloads through the application.

## Testing Guidelines

Prioritize tests around money-moving behavior. Cover order sizing, risk limits, exchange error handling, duplicate order prevention, restart recovery, and strategy edge cases. Use mocks or sandbox APIs for exchange integrations.

Backtests should state assumptions, fees, slippage, sample period, and data source. Do not treat backtest profit as proof of live profitability.

## Security & Configuration

Never commit API keys, wallet credentials, seed phrases, `.env` files, or production config. Use environment variables or a secret manager. Default all examples to paper trading, read-only keys, or sandbox endpoints.

Add kill switches, max-loss limits, and explicit dry-run modes before enabling live execution.

## Commit & Pull Request Guidelines

This directory may not yet have meaningful Git history, so use concise, imperative commit messages such as `Add paper order executor` or `Document AWS deployment tradeoffs`.

Pull requests should include a summary, test results, risk impact, configuration changes, and screenshots or logs for dashboards. For architecture changes, link the related decision note.

## Agent-Specific Instructions

Before editing, inspect existing files and follow established patterns. Keep changes narrow unless the user approves a broader redesign. Surface architectural implications, cost estimates, and operational risks early, especially for cloud hosting, data feeds, databases, monitoring, and live trading.
