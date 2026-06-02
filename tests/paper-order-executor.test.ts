import { describe, expect, it } from "vitest";
import { PaperOrderExecutor } from "../src/execution/paper-order-executor.js";
import { InMemoryPortfolioStore } from "../src/portfolio/in-memory-portfolio-store.js";

describe("PaperOrderExecutor", () => {
  it("fills a buy order and updates portfolio cash and position", async () => {
    const portfolio = new InMemoryPortfolioStore(10_000);
    const executor = new PaperOrderExecutor(portfolio, async () => 100, {
      feeRate: 0.001,
      slippageBps: 10
    });

    const result = await executor.placeOrder({
      symbol: "DEMO/USD",
      side: "buy",
      type: "market",
      quantity: 10,
      limitPrice: 100,
      reason: "test buy",
      strategyId: "test-strategy"
    });

    const snapshot = await portfolio.getAccountSnapshot();
    const positions = await portfolio.getOpenPositions();

    expect(result.order.status).toBe("filled");
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]?.price).toBeCloseTo(100.1);
    expect(positions[0]?.quantity).toBe(10);
    expect(snapshot.cash).toBeCloseTo(8_997.999);
  });

  it("realizes PnL when reducing a long position", async () => {
    const portfolio = new InMemoryPortfolioStore(10_000);
    const executor = new PaperOrderExecutor(portfolio, async () => 100, {
      feeRate: 0,
      slippageBps: 0
    });

    await executor.placeOrder({
      symbol: "DEMO/USD",
      side: "buy",
      type: "market",
      quantity: 10,
      limitPrice: 100,
      reason: "open long",
      strategyId: "test-strategy"
    });

    const sellExecutor = new PaperOrderExecutor(portfolio, async () => 110, {
      feeRate: 0,
      slippageBps: 0
    });
    await sellExecutor.placeOrder({
      symbol: "DEMO/USD",
      side: "sell",
      type: "market",
      quantity: 4,
      limitPrice: 110,
      reason: "reduce long",
      strategyId: "test-strategy"
    });

    const snapshot = await portfolio.getAccountSnapshot();
    const positions = await portfolio.getOpenPositions();

    expect(snapshot.realizedPnl).toBeCloseTo(40);
    expect(positions[0]?.quantity).toBe(6);
    expect(positions[0]?.averageEntryPrice).toBe(100);
  });
});
