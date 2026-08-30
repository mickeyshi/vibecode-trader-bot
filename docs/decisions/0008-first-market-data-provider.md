# 0008 First Market Data Provider

## Context

The project needs a first live-ingest path for equities data before adding paper-mode feed replay or
hosted monitoring. This should remain read-only and must not enable live trading execution.

Alpaca provides US equities market-data endpoints, including free IEX data for eligible accounts.
The latest-bars REST endpoint is `https://data.alpaca.markets/v2/stocks/bars/latest` and supports a
`feed` parameter. Alpaca documents `iex` as Investors Exchange data. Alpaca authentication for
regular users uses the `APCA-API-KEY-ID` and `APCA-API-SECRET-KEY` headers.

## Options Considered

1. Start with Alpaca IEX equities latest bars over REST.
2. Start with Alpaca IEX WebSocket bars.
3. Start with a crypto public WebSocket feed.
4. Keep using historical fixture files only.

## Decision

Start live ingest with Alpaca IEX equities latest bars over REST.

The first implementation should:

- use read-only market-data credentials
- request the `iex` feed explicitly
- normalize provider payloads into internal `Candle` values
- support a small symbol list
- expose a CLI smoke command for manual ingest checks
- avoid trading endpoints, order placement, account access, or live execution behavior

## Tradeoffs

REST latest bars are easier to test, retry, and observe than WebSocket streams. They are also less
representative of a true continuous live feed.

The IEX feed is not full-market SIP data. It is useful for early ingest plumbing, normalization, and
observability tests, but it should not be treated as complete market coverage.

## Consequences

- The first provider adapter is Alpaca IEX latest bars.
- WebSocket ingest can be added later after REST polling proves the feed boundary.
- SIP data, paid subscriptions, and full-market coverage remain future decisions.
- Live trading remains blocked by the existing live-trading blocker list.
