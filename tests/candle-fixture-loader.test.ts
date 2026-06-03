import { describe, expect, it } from "vitest";
import {
  loadCandlesFromFixture,
  parseCandleCsv,
  parseCandleJson
} from "../src/fixtures/candle-fixture-loader.js";

describe("candle fixture loader", () => {
  it("parses standard OHLCV CSV", () => {
    const candles = parseCandleCsv(
      [
        "timestamp,open,high,low,close,volume",
        "2026-01-01T09:31:00.000Z,100,101,99,100.5,1200"
      ].join("\n"),
      { symbol: "DEMO/USD", timeframe: "1m" }
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]?.symbol).toBe("DEMO/USD");
    expect(candles[0]?.close).toBe(100.5);
  });

  it("parses Alpha Vantage daily JSON shape", () => {
    const candles = parseCandleJson(
      JSON.stringify({
        "Time Series (Daily)": {
          "2026-01-02": {
            "1. open": "101",
            "2. high": "103",
            "3. low": "100",
            "4. close": "102",
            "5. volume": "1500"
          }
        }
      }),
      { symbol: "IBM", timeframe: "1d" }
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]?.symbol).toBe("IBM");
    expect(candles[0]?.timeframe).toBe("1d");
    expect(candles[0]?.volume).toBe(1500);
  });

  it("parses Stooq text export shape", () => {
    const candles = parseCandleCsv(
      [
        "<TICKER>,<PER>,<DATE>,<TIME>,<OPEN>,<HIGH>,<LOW>,<CLOSE>,<VOL>,<OPENINT>",
        "USDBTC,D,20100719,000000,11.6496,12.9483,10.7446,12.3762,0,0"
      ].join("\n"),
      { symbol: "USDBTC", timeframe: "1d" }
    );

    expect(candles).toHaveLength(1);
    expect(candles[0]?.symbol).toBe("USDBTC");
    expect(candles[0]?.closeTime.toISOString()).toBe("2010-07-19T00:00:00.000Z");
    expect(candles[0]?.close).toBe(12.3762);
  });

  it("loads the curated Stooq sample fixture", async () => {
    const candles = await loadCandlesFromFixture("test-fixtures/stooq-1mcay-sample.txt", {
      symbol: "1MCAY.B",
      timeframe: "1d"
    });

    expect(candles).toHaveLength(7);
    expect(candles[0]?.symbol).toBe("1MCAY.B");
    expect(candles[0]?.closeTime.toISOString()).toBe("1994-03-15T00:00:00.000Z");
    expect(candles.at(-1)?.close).toBe(4.03);
  });

  it("loads the curated Stooq crypto sample fixture", async () => {
    const candles = await loadCandlesFromFixture("test-fixtures/stooq-hbar-sample.txt", {
      symbol: "HBAR.V",
      timeframe: "1d"
    });

    expect(candles).toHaveLength(7);
    expect(candles[0]?.symbol).toBe("HBAR.V");
    expect(candles[0]?.closeTime.toISOString()).toBe("2019-09-20T00:00:00.000Z");
    expect(candles.at(-1)?.close).toBe(0.02899);
  });
});
