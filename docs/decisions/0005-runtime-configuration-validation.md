# 0005 Runtime Configuration Validation

## Context

The backtest CLI currently accepts flags, optional positional fixture arguments, and a flat JSON
config file. CLI parsing is intentionally lightweight, while config-file validation is hand-written
in `src/eval/backtest-cli.ts`.

The project will eventually need runtime validation for more external inputs: dashboard settings,
environment variables, exchange payloads, market/news feed payloads, and possibly hosted deployment
configuration. ADR 0002 already notes that TypeScript types do not validate runtime data by
themselves.

## Options Considered

1. Keep all runtime validation hand-written.
2. Move all CLI parsing and config validation into a schema library.
3. Keep CLI parsing lightweight, but use schema-backed validation for config, environment, and
   external data boundaries.

## Decision

Keep CLI parsing lightweight and adopt schema-backed runtime validation for configuration and
external input boundaries.

CLI parsing may continue to translate flags into raw values and preserve simple override behavior.
Structured values loaded from config files, environment variables, feed payloads, exchange payloads,
and future dashboard settings should be validated through explicit schemas before entering core
application code.

Schemas should live near the boundary they validate. They should produce typed application objects
after validation, but they should not replace the domain interfaces used inside strategy, risk,
execution, portfolio, and evaluation modules.

## Tradeoffs

This keeps the CLI small and easy to inspect while reducing the amount of brittle hand-written
validation as config shapes grow.

The tradeoff is adding a dependency and maintaining schema definitions alongside TypeScript
interfaces. That duplication is acceptable at external boundaries where runtime data can be
malformed, missing, stale, or provider-specific.

## Consequences

- The next meaningful expansion of config validation should introduce a small schema library.
- Backtest config files and future dashboard settings should be early schema-backed candidates.
- Environment variable validation should use the same general approach before adding live trading,
  exchange credentials, hosted deployment settings, or paid data-provider settings.
- CLI argument parsing should remain straightforward and should not become a full framework.
