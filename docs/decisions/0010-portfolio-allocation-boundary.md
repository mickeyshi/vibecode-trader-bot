# 0010 Portfolio Allocation Boundary

## Context

Cross-symbol strategies rank instruments and produce a portfolio of target weights. The existing
`Strategy` interface evaluates one symbol at a time, while risk and execution operate on concrete
order intents. Hiding portfolio ranking inside a stateful per-symbol strategy would make results
depend on evaluation order and blur the strategy, allocation, risk, and execution boundaries.

## Decision

Introduce a `PortfolioAllocator` boundary under `src/portfolio/`. It consumes normalized historical
features and optional normalized events and returns bounded target weights, cash weight, reasons,
and vetoed symbols. It cannot submit orders. Translating target weights into orders, applying risk,
and execution remain separate future steps.

Implement ETF relative momentum as the first allocator. High-importance negative news may veto a
symbol but cannot cause a purchase. The initial dry-run command reads local research data only and
explicitly reports that it has no broker access or order submission.

## Tradeoffs

This adds a distinct planning stage and requires future target-to-intent reconciliation. In return,
cross-symbol ranking is deterministic, independently testable, and unable to bypass risk or broker
safety. It also prevents forcing portfolio semantics into the per-symbol signal interface.

## Consequences

- The research simulator and future execution adapters can share allocation logic.
- Target weights remain proposals until converted, risk checked, and safely executed.
- The current ETF model stays disconnected from paper execution because rolling results failed the
  promotion criteria.
