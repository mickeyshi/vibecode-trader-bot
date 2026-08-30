import { describe, expect, it } from "vitest";
import type { Candle, Order, Position } from "../src/core/types.js";
import {
  runAlpacaPaperConnectivityCheck,
  type AlpacaPaperConnectivityBroker,
  type AlpacaPaperConnectivityMarketData
} from "../src/execution/alpaca-paper-connectivity-check.js";
import type { AccountSnapshot } from "../src/portfolio/interfaces.js";

describe("Alpaca paper connectivity check", () => {
  it("checks paper account, positions, open orders, and latest bars without placing orders", async () => {
    const broker = new FakeBroker();
    const marketData = new FakeMarketData();
    const result = await runAlpacaPaperConnectivityCheck({
      broker,
      marketData,
      symbols: ["spy", "SPY", "aapl"],
      now: new Date("2026-06-24T14:31:00.000Z")
    });

    expect(result).toMatchObject({
      provider: "alpaca",
      mode: "paper",
      readOnly: true,
      checkedAt: "2026-06-24T14:31:00.000Z",
      status: "pass",
      account: {
        equity: 100_000,
        cash: 99_950,
        buyingPower: 399_950,
        grossExposure: 50,
        currency: "USD"
      },
      positions: {
        count: 1,
        symbols: ["SPY"],
        grossExposure: 50
      },
      openOrders: {
        count: 0,
        symbols: []
      },
      marketData: {
        symbols: ["SPY", "AAPL"]
      },
      warnings: []
    });
    expect(result.marketData.candles.map((candle) => candle.symbol)).toEqual(["SPY", "AAPL"]);
    expect(broker.accountCalls).toBe(1);
    expect(broker.positionCalls).toBe(1);
    expect(broker.openOrderCalls).toBe(1);
    expect(marketData.symbolCalls).toEqual([["SPY", "AAPL"]]);
  });

  it("returns warnings for stale candles and existing open orders", async () => {
    const broker = new FakeBroker();
    broker.openOrders = [openOrder("SPY")];
    const result = await runAlpacaPaperConnectivityCheck({
      broker,
      marketData: new FakeMarketData(),
      symbols: ["SPY"],
      maxCandleAgeMs: 30_000,
      now: new Date("2026-06-24T14:31:00.000Z")
    });

    expect(result.status).toBe("warning");
    expect(result.warnings).toEqual([
      "Latest candle for SPY is stale by 60 seconds.",
      "1 open paper order(s) already exist."
    ]);
    expect(result.openOrders).toEqual({
      count: 1,
      symbols: ["SPY"]
    });
    expect(result.marketData.candles[0]).toMatchObject({
      symbol: "SPY",
      ageSeconds: 60,
      stale: true
    });
  });

  it("rejects live trading mode", async () => {
    await expect(
      runAlpacaPaperConnectivityCheck({
        broker: new FakeBroker("live"),
        marketData: new FakeMarketData(),
        symbols: ["SPY"]
      })
    ).rejects.toThrow("requires paper trading mode");
  });
});

class FakeBroker implements AlpacaPaperConnectivityBroker {
  accountCalls = 0;
  positionCalls = 0;
  openOrderCalls = 0;
  openOrders: Order[] = [];

  constructor(readonly mode: "paper" | "live" = "paper") {}

  async getAccountSnapshot(): Promise<AccountSnapshot> {
    this.accountCalls += 1;
    return {
      equity: 100_000,
      cash: 99_950,
      buyingPower: 399_950,
      realizedPnl: 0,
      unrealizedPnl: 0,
      positionValue: 50,
      grossExposure: 50,
      currency: "USD",
      timestamp: new Date("2026-06-24T14:30:00.000Z")
    };
  }

  async getOpenPositions(): Promise<Position[]> {
    this.positionCalls += 1;
    return [
      {
        symbol: "SPY",
        quantity: 0.1,
        averageEntryPrice: 500,
        markPrice: 500,
        unrealizedPnl: 0,
        updatedAt: new Date("2026-06-24T14:30:00.000Z")
      }
    ];
  }

  async getOpenOrders(): Promise<Order[]> {
    this.openOrderCalls += 1;
    return this.openOrders;
  }
}

class FakeMarketData implements AlpacaPaperConnectivityMarketData {
  readonly symbolCalls: string[][] = [];

  async getLatestBars(symbols: string[]): Promise<Candle[]> {
    this.symbolCalls.push(symbols);
    return symbols.map((symbol) => ({
      symbol,
      timeframe: "1m",
      openTime: new Date("2026-06-24T14:29:00.000Z"),
      closeTime: new Date("2026-06-24T14:30:00.000Z"),
      open: symbol === "SPY" ? 500 : 250,
      high: symbol === "SPY" ? 501 : 251,
      low: symbol === "SPY" ? 499 : 249,
      close: symbol === "SPY" ? 500 : 250,
      volume: 1000
    }));
  }
}

function openOrder(symbol: string): Order {
  const now = new Date("2026-06-24T14:30:00.000Z");
  return {
    id: `open-${symbol.toLowerCase()}`,
    intent: {
      symbol,
      side: "buy",
      type: "market",
      quantity: 0.05,
      reason: "existing open paper order",
      strategyId: "buy-and-hold"
    },
    status: "accepted",
    createdAt: now,
    updatedAt: now
  };
}
