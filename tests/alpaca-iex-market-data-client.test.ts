import { describe, expect, it } from "vitest";
import { loadAlpacaIexMarketDataConfig, parseSymbolList } from "../src/feeds/alpaca-iex-config.js";
import {
  AlpacaIexMarketDataClient,
  parseHistoricalBarsResponse,
  parseLatestBarsResponse,
  type AlpacaFetch
} from "../src/feeds/alpaca-iex-market-data-client.js";

describe("AlpacaIexMarketDataClient", () => {
  it("normalizes descending historical bars into chronological order", () => {
    const candles = parseHistoricalBarsResponse(
      {
        bars: {
          SPY: [makeBar("2026-01-01T15:31:00Z"), makeBar("2026-01-01T15:30:00Z")]
        }
      },
      ["spy"]
    );

    expect(candles.map((candle) => candle.openTime.toISOString())).toEqual([
      "2026-01-01T15:30:00.000Z",
      "2026-01-01T15:31:00.000Z"
    ]);
  });

  it("requests a bounded historical window separately for each symbol", async () => {
    const urls: string[] = [];
    const fetchImpl: AlpacaFetch = async (url) => {
      urls.push(url);
      const symbol = new URL(url).searchParams.get("symbols")!;
      return response({ bars: { [symbol]: [] } });
    };
    const client = new AlpacaIexMarketDataClient(
      {
        apiKeyId: "key-id",
        apiSecretKey: "secret-key",
        baseUrl: "https://data.alpaca.markets",
        feed: "iex",
        symbols: ["SPY", "AAPL"]
      },
      fetchImpl
    );

    await client.getHistoricalBars(undefined, {
      limit: 100,
      end: new Date("2026-01-01T15:32:00.000Z")
    });

    expect(urls).toHaveLength(2);
    expect(urls.every((url) => url.includes("timeframe=1Min") && url.includes("limit=100"))).toBe(
      true
    );
    expect(new URL(urls[0]!).searchParams.get("start")).toBe("2025-12-18T15:32:00.000Z");
    expect(urls.map((url) => new URL(url).searchParams.get("symbols")).sort()).toEqual([
      "AAPL",
      "SPY"
    ]);
  });

  it("rejects an excessive historical-bar window before fetching", async () => {
    const client = new AlpacaIexMarketDataClient(
      {
        apiKeyId: "key-id",
        apiSecretKey: "secret-key",
        baseUrl: "https://data.alpaca.markets",
        feed: "iex",
        symbols: ["SPY"]
      },
      async () => response({ bars: { SPY: [] } })
    );

    await expect(client.getHistoricalBars(undefined, { limit: 10_001 })).rejects.toThrow(
      "limit must be an integer from 1 through 10000"
    );
  });

  it("accepts a valid response with no bars for the requested symbol", () => {
    expect(parseHistoricalBarsResponse({ bars: {} }, ["SPY"])).toEqual([]);
  });

  it("requests latest IEX bars with Alpaca auth headers", async () => {
    const seen: { url?: string; headers?: Record<string, string> } = {};
    const fetchImpl: AlpacaFetch = async (url, init) => {
      seen.url = url;
      seen.headers = init.headers;

      return response({
        bars: {
          SPY: makeBar("2026-01-01T15:30:00Z")
        }
      });
    };
    const client = new AlpacaIexMarketDataClient(
      {
        apiKeyId: "key-id",
        apiSecretKey: "secret-key",
        baseUrl: "https://data.alpaca.markets",
        feed: "iex",
        symbols: ["SPY"]
      },
      fetchImpl
    );

    const candles = await client.getLatestBars();

    expect(seen.url).toContain("https://data.alpaca.markets/v2/stocks/bars/latest");
    expect(seen.url).toContain("symbols=SPY");
    expect(seen.url).toContain("feed=iex");
    expect(seen.headers).toMatchObject({
      "APCA-API-KEY-ID": "key-id",
      "APCA-API-SECRET-KEY": "secret-key"
    });
    expect(candles[0]).toMatchObject({
      symbol: "SPY",
      timeframe: "1m",
      open: 100,
      high: 101,
      low: 99,
      close: 100.5,
      volume: 1000
    });
    expect(candles[0]?.closeTime.toISOString()).toBe("2026-01-01T15:31:00.000Z");
  });

  it("normalizes multiple requested symbols in request order", () => {
    const candles = parseLatestBarsResponse(
      {
        bars: {
          MSFT: makeBar("2026-01-01T15:31:00Z"),
          AAPL: makeBar("2026-01-01T15:30:00Z")
        }
      },
      ["AAPL", "MSFT"]
    );

    expect(candles.map((candle) => candle.symbol)).toEqual(["AAPL", "MSFT"]);
  });

  it("rejects malformed latest bar payloads", () => {
    expect(() => parseLatestBarsResponse({ bars: { SPY: { c: 100 } } }, ["SPY"])).toThrow(
      "Alpaca latest bar SPY.t must be a string timestamp"
    );
  });

  it("surfaces Alpaca HTTP failures", async () => {
    const fetchImpl: AlpacaFetch = async () =>
      response({ message: "too many requests" }, false, 429, "Too Many Requests");
    const client = new AlpacaIexMarketDataClient(
      {
        apiKeyId: "key-id",
        apiSecretKey: "secret-key",
        baseUrl: "https://data.alpaca.markets",
        feed: "iex",
        symbols: ["SPY"]
      },
      fetchImpl
    );

    await expect(client.getLatestBars()).rejects.toThrow("429 Too Many Requests");
  });

  it("retries transient Alpaca latest-bar failures", async () => {
    let attempt = 0;
    const fetchImpl: AlpacaFetch = async () => {
      attempt += 1;
      return attempt === 1
        ? response({ message: "rate limited" }, false, 429, "Too Many Requests")
        : response({
            bars: {
              SPY: makeBar("2026-01-01T15:30:00Z")
            }
          });
    };
    const client = new AlpacaIexMarketDataClient(
      {
        apiKeyId: "key-id",
        apiSecretKey: "secret-key",
        baseUrl: "https://data.alpaca.markets",
        feed: "iex",
        symbols: ["SPY"]
      },
      fetchImpl,
      {
        initialDelayMs: 0
      }
    );

    await expect(client.getLatestBars()).resolves.toHaveLength(1);
    expect(attempt).toBe(2);
  });
});

describe("Alpaca IEX config", () => {
  it("loads read-only market data config from environment-like values", () => {
    expect(
      loadAlpacaIexMarketDataConfig({
        ALPACA_DATA_API_KEY_ID: "key-id",
        ALPACA_DATA_API_SECRET_KEY: "secret-key",
        ALPACA_SYMBOLS: "spy, aapl"
      })
    ).toMatchObject({
      apiKeyId: "key-id",
      apiSecretKey: "secret-key",
      baseUrl: "https://data.alpaca.markets",
      feed: "iex",
      symbols: ["SPY", "AAPL"]
    });
  });

  it("requires credentials", () => {
    expect(() => loadAlpacaIexMarketDataConfig({})).toThrow("ALPACA_DATA_API_KEY_ID");
  });

  it("parses a non-empty symbol list", () => {
    expect(parseSymbolList("spy,msft")).toEqual(["SPY", "MSFT"]);
    expect(() => parseSymbolList(" , ")).toThrow("At least one Alpaca symbol");
  });
});

function makeBar(timestamp: string): Record<string, unknown> {
  return {
    t: timestamp,
    o: 100,
    h: 101,
    l: 99,
    c: 100.5,
    v: 1000
  };
}

function response(
  body: unknown,
  ok = true,
  status = 200,
  statusText = "OK"
): Awaited<ReturnType<AlpacaFetch>> {
  return {
    ok,
    status,
    statusText,
    async text() {
      return JSON.stringify(body);
    }
  };
}
