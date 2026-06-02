# 0002: TypeScript Runtime

## Status

Accepted.

## Context

The first-pass interfaces are already TypeScript-shaped, and the project needs a maintainable application framework for feeds, risk controls, execution adapters, backtests, and a future dashboard/API.

Python remains attractive for notebooks, pandas-heavy research, and ML workflows. For this project, the first implementation pass prioritizes explicit interfaces, application structure, refactor safety, and eventual web/API integration.

## Decision

Use TypeScript on Node.js as the primary runtime. Start with strict compiler settings, npm scripts, Vitest for tests, ESLint for static checks, and Prettier for formatting.

## Consequences

- Strategy, risk, execution, and portfolio boundaries can stay strongly typed.
- Runtime validation is still required for external inputs such as exchange responses, config, environment variables, and data-feed payloads.
- Research-heavy workflows may later justify Python helper scripts or notebooks, but those should not own live execution behavior.
- Node.js services should remain container-friendly for DigitalOcean App Platform and future hosting migration options.
