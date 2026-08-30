import { describe, expect, it } from "vitest";
import type { OrderIntent } from "../src/core/types.js";
import {
  AlpacaOrderExecutor,
  type AlpacaTradingFetch
} from "../src/execution/alpaca-order-executor.js";
import {
  loadAlpacaTradingConfig,
  parseTradingMode
} from "../src/execution/alpaca-trading-config.js";

const intent: OrderIntent = {
  symbol: "SPY",
  side: "buy",
  type: "limit",
  quantity: 2,
  limitPrice: 420.5,
  reason: "test",
  strategyId: "moving-average-crossover"
};

describe("AlpacaOrderExecutor", () => {
  it("submits limit orders with Alpaca trading auth headers", async () => {
    const seen: { url?: string; headers?: Record<string, string>; body?: unknown } = {};
    const fetchImpl: AlpacaTradingFetch = async (url, init) => {
      seen.url = url;
      seen.headers = init.headers;
      seen.body = init.body ? JSON.parse(init.body) : undefined;

      return response({
        id: "order-1",
        symbol: "SPY",
        side: "buy",
        type: "limit",
        qty: "2",
        limit_price: "420.5",
        status: "accepted",
        created_at: "2026-06-19T14:30:00Z",
        updated_at: "2026-06-19T14:30:01Z",
        filled_qty: "0"
      });
    };
    const executor = new AlpacaOrderExecutor(
      {
        apiKeyId: "key-id",
        apiSecretKey: "secret-key",
        baseUrl: "https://paper-api.alpaca.markets",
        mode: "paper"
      },
      fetchImpl
    );

    const result = await executor.placeOrder(intent);

    expect(seen.url).toBe("https://paper-api.alpaca.markets/v2/orders");
    expect(seen.headers).toMatchObject({
      "APCA-API-KEY-ID": "key-id",
      "APCA-API-SECRET-KEY": "secret-key",
      "Content-Type": "application/json"
    });
    expect(seen.body).toMatchObject({
      symbol: "SPY",
      qty: "2",
      side: "buy",
      type: "limit",
      time_in_force: "day",
      client_order_id: expect.stringMatching(/^bot-moving-average-cross-SPY-/),
      limit_price: "420.5"
    });
    expect(result.order).toMatchObject({
      id: "order-1",
      status: "accepted"
    });
    expect(result.fills).toEqual([]);
  });

  it("creates unique symbol-aware client order ids for rapid paper orders", async () => {
    const submittedBodies: Array<Record<string, string>> = [];
    let orderCount = 0;
    const executor = new AlpacaOrderExecutor(makeConfig(), async (_url, init) => {
      const body = init.body ? (JSON.parse(init.body) as Record<string, string>) : {};
      submittedBodies.push(body);
      orderCount += 1;

      return response({
        id: `order-${orderCount}`,
        symbol: body.symbol,
        side: body.side,
        type: body.type,
        qty: body.qty,
        status: "accepted",
        created_at: "2026-06-19T14:30:00Z",
        updated_at: "2026-06-19T14:30:00Z",
        filled_qty: "0",
        client_order_id: body.client_order_id
      });
    });

    await executor.placeOrder({
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 2,
      reason: "test",
      strategyId: "moving-average-crossover"
    });
    await executor.placeOrder({
      symbol: "AAPL",
      side: "buy",
      type: "market",
      quantity: 2,
      reason: "test",
      strategyId: "moving-average-crossover"
    });

    expect(submittedBodies).toHaveLength(2);
    expect(submittedBodies[0]?.client_order_id).toMatch(/^bot-moving-average-cross-SPY-/);
    expect(submittedBodies[1]?.client_order_id).toMatch(/^bot-moving-average-cross-AAPL-/);
    expect(submittedBodies[0]?.client_order_id).not.toBe(submittedBodies[1]?.client_order_id);
  });

  it("uses a pre-journaled idempotency key as the Alpaca client order id", async () => {
    let submitted: Record<string, string> = {};
    const executor = new AlpacaOrderExecutor(makeConfig(), async (_url, init) => {
      submitted = JSON.parse(init.body!) as Record<string, string>;
      return response({
        id: "order-journaled",
        symbol: "SPY",
        side: "buy",
        type: "market",
        qty: "0.05",
        status: "accepted",
        created_at: "2026-06-19T14:30:00Z",
        client_order_id: submitted.client_order_id
      });
    });

    await executor.placeOrder({ ...intent, type: "market", idempotencyKey: "bot-durable-key" });
    expect(submitted.client_order_id).toBe("bot-durable-key");
  });

  it("looks up orders by client order id and treats a 404 as absent", async () => {
    const urls: string[] = [];
    let call = 0;
    const executor = new AlpacaOrderExecutor(makeConfig(), async (url) => {
      urls.push(url);
      call += 1;
      return call === 1
        ? response({
            id: "order-lookup",
            symbol: "SPY",
            side: "buy",
            type: "market",
            qty: "0.05",
            status: "accepted",
            created_at: "2026-06-19T14:30:00Z",
            client_order_id: "bot-durable-key"
          })
        : response({ message: "not found" }, false, 404, "Not Found");
    });

    await expect(executor.getOrderByClientOrderId("bot-durable-key")).resolves.toMatchObject({
      id: "order-lookup"
    });
    await expect(executor.getOrderByClientOrderId("missing")).resolves.toBeUndefined();
    expect(urls[0]).toContain("/v2/orders:by_client_order_id?client_order_id=bot-durable-key");
  });

  it("creates a synthetic fill when Alpaca reports a filled quantity and average price", async () => {
    const executor = new AlpacaOrderExecutor(makeConfig(), async () =>
      response({
        id: "order-2",
        symbol: "SPY",
        side: "buy",
        type: "market",
        qty: "1",
        status: "filled",
        created_at: "2026-06-19T14:30:00Z",
        updated_at: "2026-06-19T14:30:02Z",
        filled_qty: "1",
        filled_avg_price: "421.10"
      })
    );

    const result = await executor.placeOrder({
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 2,
      reason: "test",
      strategyId: "moving-average-crossover"
    });

    expect(result.order.status).toBe("filled");
    expect(result.order).toMatchObject({
      filledQuantity: 1,
      averageFillPrice: 421.1
    });
    expect(result.fills[0]).toMatchObject({
      orderId: "order-2",
      symbol: "SPY",
      quantity: 1,
      price: 421.1,
      fee: 0
    });
  });

  it("submits fractional market quantities for small notional paper orders", async () => {
    const seen: { body?: unknown } = {};
    const executor = new AlpacaOrderExecutor(makeConfig(), async (_url, init) => {
      seen.body = init.body ? JSON.parse(init.body) : undefined;

      return response({
        id: "order-3",
        symbol: "SPY",
        side: "buy",
        type: "market",
        qty: "0.05",
        status: "accepted",
        created_at: "2026-06-19T14:30:00Z",
        updated_at: "2026-06-19T14:30:00Z",
        filled_qty: "0"
      });
    });

    await executor.placeOrder({
      symbol: "SPY",
      side: "buy",
      type: "market",
      quantity: 0.05,
      limitPrice: 500,
      reason: "small paper validation trade",
      strategyId: "buy-and-hold"
    });

    expect(seen.body).toMatchObject({
      symbol: "SPY",
      qty: "0.05",
      side: "buy",
      type: "market",
      time_in_force: "day"
    });
  });

  it("loads account snapshots from Alpaca account fields", async () => {
    const executor = new AlpacaOrderExecutor(makeConfig(), async () =>
      response({
        equity: "10050.25",
        cash: "9000.00",
        buying_power: "18000.00",
        currency: "USD",
        long_market_value: "1050.25",
        short_market_value: "0"
      })
    );

    const snapshot = await executor.getAccountSnapshot();

    expect(snapshot).toMatchObject({
      equity: 10050.25,
      cash: 9000,
      buyingPower: 18000,
      grossExposure: 1050.25,
      positionValue: 1050.25,
      currency: "USD"
    });
  });

  it("loads open positions from Alpaca position fields", async () => {
    const executor = new AlpacaOrderExecutor(makeConfig(), async () =>
      response([
        {
          symbol: "SPY",
          qty: "2",
          avg_entry_price: "420.00",
          current_price: "421.25",
          unrealized_pl: "2.50"
        }
      ])
    );

    const positions = await executor.getOpenPositions();

    expect(positions[0]).toMatchObject({
      symbol: "SPY",
      quantity: 2,
      averageEntryPrice: 420,
      markPrice: 421.25,
      unrealizedPnl: 2.5
    });
  });

  it("requests Alpaca positions from the trading API", async () => {
    const seen: { url?: string; method?: string } = {};
    const executor = new AlpacaOrderExecutor(makeConfig(), async (url, init) => {
      seen.url = url;
      seen.method = init.method;
      return response([]);
    });

    await executor.getOpenPositions();

    expect(seen).toMatchObject({
      url: "https://paper-api.alpaca.markets/v2/positions",
      method: "GET"
    });
  });

  it("loads open orders from Alpaca for pending-order reconciliation", async () => {
    const seen: { url?: string; method?: string } = {};
    const executor = new AlpacaOrderExecutor(makeConfig(), async (url, init) => {
      seen.url = url;
      seen.method = init.method;

      return response([
        {
          id: "order-open-1",
          symbol: "SPY",
          side: "buy",
          type: "market",
          qty: "0.05",
          status: "accepted",
          created_at: "2026-06-19T14:30:00Z",
          updated_at: "2026-06-19T14:30:01Z",
          filled_qty: "0.02",
          filled_avg_price: "500.25",
          client_order_id: "buy-and-hold-123"
        }
      ]);
    });

    const orders = await executor.getOpenOrders();

    expect(seen).toMatchObject({
      url: "https://paper-api.alpaca.markets/v2/orders?status=open",
      method: "GET"
    });
    expect(orders[0]).toMatchObject({
      id: "order-open-1",
      status: "accepted",
      intent: {
        symbol: "SPY",
        side: "buy",
        type: "market",
        quantity: 0.05,
        strategyId: "buy-and-hold-123"
      },
      filledQuantity: 0.02,
      averageFillPrice: 500.25
    });
  });

  it("loads and normalizes the authoritative Alpaca market calendar", async () => {
    const seen: string[] = [];
    const executor = new AlpacaOrderExecutor(makeConfig(), async (url) => {
      seen.push(url);
      return response([{ date: "2026-11-27", open: "09:30", close: "13:00" }]);
    });

    await expect(executor.getMarketCalendar("2026-11-27")).resolves.toEqual([
      { date: "2026-11-27", openTime: "09:30", closeTime: "13:00" }
    ]);
    expect(seen).toEqual([
      "https://paper-api.alpaca.markets/v2/calendar?start=2026-11-27&end=2026-11-27"
    ]);
  });

  it("surfaces Alpaca trading HTTP failures", async () => {
    const executor = new AlpacaOrderExecutor(makeConfig(), async () =>
      response({ message: "insufficient buying power" }, false, 403, "Forbidden")
    );

    await expect(executor.placeOrder(intent)).rejects.toThrow("403 Forbidden");
  });

  it("retries transient Alpaca trading failures", async () => {
    let attempt = 0;
    const executor = new AlpacaOrderExecutor(
      makeConfig(),
      async () => {
        attempt += 1;
        return attempt === 1
          ? response({ message: "temporarily unavailable" }, false, 503, "Service Unavailable")
          : response({
              id: "order-retry-1",
              symbol: "SPY",
              side: "buy",
              type: "limit",
              qty: "2",
              limit_price: "420.5",
              status: "accepted",
              created_at: "2026-06-19T14:30:00Z",
              updated_at: "2026-06-19T14:30:01Z",
              filled_qty: "0"
            });
      },
      {
        initialDelayMs: 0
      }
    );

    await expect(executor.placeOrder(intent)).resolves.toMatchObject({
      order: {
        id: "order-retry-1",
        status: "accepted"
      }
    });
    expect(attempt).toBe(2);
  });

  it("does not retry non-retryable Alpaca trading failures", async () => {
    let attempt = 0;
    const executor = new AlpacaOrderExecutor(
      makeConfig(),
      async () => {
        attempt += 1;
        return response({ message: "insufficient buying power" }, false, 403, "Forbidden");
      },
      {
        initialDelayMs: 0
      }
    );

    await expect(executor.placeOrder(intent)).rejects.toThrow("403 Forbidden");
    expect(attempt).toBe(1);
  });

  it("requires limit prices for limit orders", async () => {
    const executor = new AlpacaOrderExecutor(makeConfig(), async () => response({}));

    await expect(
      executor.placeOrder({
        symbol: "SPY",
        side: "buy",
        type: "limit",
        quantity: 2,
        reason: "test",
        strategyId: "moving-average-crossover"
      })
    ).rejects.toThrow("Limit orders require limitPrice");
  });
});

describe("Alpaca trading config", () => {
  it("loads paper trading config by default", () => {
    expect(
      loadAlpacaTradingConfig({
        ALPACA_TRADING_API_KEY_ID: "key-id",
        ALPACA_TRADING_API_SECRET_KEY: "secret-key"
      })
    ).toMatchObject({
      apiKeyId: "key-id",
      apiSecretKey: "secret-key",
      baseUrl: "https://paper-api.alpaca.markets",
      mode: "paper"
    });
  });

  it("loads live trading config when explicitly requested", () => {
    expect(
      loadAlpacaTradingConfig({
        ALPACA_TRADING_API_KEY_ID: "key-id",
        ALPACA_TRADING_API_SECRET_KEY: "secret-key",
        ALPACA_TRADING_MODE: "live"
      })
    ).toMatchObject({
      baseUrl: "https://api.alpaca.markets",
      mode: "live"
    });
  });

  it("rejects paper mode when the configured trading URL is the live Alpaca endpoint", () => {
    expect(() =>
      loadAlpacaTradingConfig({
        ALPACA_TRADING_API_KEY_ID: "key-id",
        ALPACA_TRADING_API_SECRET_KEY: "secret-key",
        ALPACA_TRADING_MODE: "paper",
        ALPACA_TRADING_BASE_URL: "https://api.alpaca.markets/"
      })
    ).toThrow("must not point at the live Alpaca API in paper mode");
  });

  it("rejects live mode when the configured trading URL is the paper Alpaca endpoint", () => {
    expect(() =>
      loadAlpacaTradingConfig({
        ALPACA_TRADING_API_KEY_ID: "key-id",
        ALPACA_TRADING_API_SECRET_KEY: "secret-key",
        ALPACA_TRADING_MODE: "live",
        ALPACA_TRADING_BASE_URL: "https://paper-api.alpaca.markets/"
      })
    ).toThrow("must not point at the paper Alpaca API in live mode");
  });

  it("allows custom paper trading proxy URLs", () => {
    expect(
      loadAlpacaTradingConfig({
        ALPACA_TRADING_API_KEY_ID: "key-id",
        ALPACA_TRADING_API_SECRET_KEY: "secret-key",
        ALPACA_TRADING_MODE: "paper",
        ALPACA_TRADING_BASE_URL: "http://localhost:8080"
      })
    ).toMatchObject({
      baseUrl: "http://localhost:8080",
      mode: "paper"
    });
  });

  it("rejects invalid trading modes", () => {
    expect(() => parseTradingMode("sandbox")).toThrow("ALPACA_TRADING_MODE must be paper or live");
  });
});

function makeConfig(): ConstructorParameters<typeof AlpacaOrderExecutor>[0] {
  return {
    apiKeyId: "key-id",
    apiSecretKey: "secret-key",
    baseUrl: "https://paper-api.alpaca.markets",
    mode: "paper"
  };
}

function response(
  body: unknown,
  ok = true,
  status = 200,
  statusText = "OK"
): Awaited<ReturnType<AlpacaTradingFetch>> {
  return {
    ok,
    status,
    statusText,
    async text() {
      return JSON.stringify(body);
    }
  };
}
