# 0003 Portfolio Accounting Policy

## Status

Accepted

## Context

The framework needs portfolio accounting rules before backtests and paper execution can be
interpreted consistently. The deferred choices were short selling, leverage, borrow costs, tax
lot accounting, and wash-sale handling.

## Decision

Use a conservative long-only, cash-only portfolio model for the current framework:

- No short selling.
- No leverage or margin.
- No borrow-cost model, because shorting is out of scope.
- Average-cost accounting only.
- No wash-sale model.

The portfolio store should reject fills that create short positions or negative cash. Strategy
sell signals may reduce or close existing long positions, but they should not open short
exposure.

## Consequences

This keeps early backtests and paper runs easier to inspect and reduces the chance of silently
simulating broker behavior we have not designed. It also means market-neutral, short-biased,
leveraged, tax-lot-aware, or wash-sale-aware workflows are intentionally unsupported.

Revisiting this decision requires a new decision note that defines account type, margin rules,
borrow-cost assumptions, forced liquidation behavior, lot selection, and reporting impact.
