# Data Fixtures

The backtest runner can load local OHLCV fixtures from CSV or JSON.

## Supported CSV Shape

```csv
timestamp,open,high,low,close,volume
2026-01-01T09:31:00.000Z,100,101,99,100,1000
```

Run it with:

```bash
npm run backtest -- test-fixtures/demo-candles.csv
```

Stooq `.txt` exports are also supported:

```csv
<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>
USDBTC,D,20100719,000000,11.6496,12.9483,10.7446,12.3762,0,0
```

Run one with:

```bash
npm run backtest -- test-fixtures/stooq-1mcay-sample.txt 1MCAY.B
npm run backtest -- --fixture test-fixtures/stooq-1mcay-sample.txt --symbol 1MCAY.B
```

`test-fixtures/stooq-1mcay-sample.txt` is a small committed sample used for routine
tests. Larger downloaded Stooq datasets belong under `test-fixtures/data/`, which is
ignored by Git and should be treated as local-only exploration data.

## Supported JSON Shapes

The loader accepts an array of candle-like rows:

```json
[
  {
    "timestamp": "2026-01-01T09:31:00.000Z",
    "open": 100,
    "high": 101,
    "low": 99,
    "close": 100,
    "volume": 1000
  }
]
```

It also accepts the Alpha Vantage daily time-series JSON shape:

```json
{
  "Time Series (Daily)": {
    "2026-01-02": {
      "1. open": "101",
      "2. high": "103",
      "3. low": "100",
      "4. close": "102",
      "5. volume": "1500"
    }
  }
}
```

## Public Demo Sources

Use public data for demos and integration tests, not deterministic unit tests. Prefer committing small synthetic fixtures for repeatable tests.

- Alpha Vantage provides daily time-series responses in JSON or CSV, including a documented `demo` API-key example for IBM.
- Stooq publishes free historical market-data downloads that can be useful for CSV-based experiments.

Always check data-provider terms before using downloaded market data beyond local experimentation.
