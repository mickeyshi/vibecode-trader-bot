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
    expect(snapshot.unrealizedPnl).toBeCloseTo(60);
    expect(snapshot.positionValue).toBeCloseTo(660);
    expect(snapshot.grossExposure).toBeCloseTo(660);
    expect(positions[0]?.quantity).toBe(6);
    expect(positions[0]?.averageEntryPrice).toBe(100);
  });

  it("includes entry fees in cost basis and realized PnL", async () => {
    const portfolio = new InMemoryPortfolioStore(10_000);
    const buyExecutor = new PaperOrderExecutor(portfolio, async () => 100, {
      feeRate: 0.01,
      slippageBps: 0
    });

    await buyExecutor.placeOrder({
      symbol: "DEMO/USD",
      side: "buy",
      type: "market",
      quantity: 10,
      limitPrice: 100,
      reason: "open long with fee",
      strategyId: "test-strategy"
    });

    let positions = await portfolio.getOpenPositions();
    expect(positions[0]?.averageEntryPrice).toBeCloseTo(101);

    const sellExecutor = new PaperOrderExecutor(portfolio, async () => 110, {
      feeRate: 0.01,
      slippageBps: 0
    });
    await sellExecutor.placeOrder({
      symbol: "DEMO/USD",
      side: "sell",
      type: "market",
      quantity: 4,
      limitPrice: 110,
      reason: "partial exit with fee",
      strategyId: "test-strategy"
    });

    const snapshot = await portfolio.getAccountSnapshot();
    positions = await portfolio.getOpenPositions();

    expect(snapshot.realizedPnl).toBeCloseTo(31.6);
    expect(positions[0]?.quantity).toBe(6);
    expect(positions[0]?.averageEntryPrice).toBeCloseTo(101);
  });

  it("rejects fills that would create negative cash", async () => {
    const portfolio = new InMemoryPortfolioStore(100);
    const executor = new PaperOrderExecutor(portfolio, async () => 100, {
      feeRate: 0,
      slippageBps: 0
    });

    await expect(
      executor.placeOrder({
        symbol: "DEMO/USD",
        side: "buy",
        type: "market",
        quantity: 2,
        limitPrice: 100,
        reason: "overspend",
        strategyId: "test-strategy"
      })
    ).rejects.toThrow("negative cash");
  });

  it("applies spread and partial fills", async () => {
    const portfolio = new InMemoryPortfolioStore(10_000);
    const executor = new PaperOrderExecutor(portfolio, async () => 100, {
      feeRate: 0,
      slippageBps: 10,
      spreadBps: 20,
      fillRatio: 0.5
    });

    const result = await executor.placeOrder({
      symbol: "DEMO/USD",
      side: "buy",
      type: "market",
      quantity: 10,
      limitPrice: 100,
      reason: "test partial",
      strategyId: "test-strategy"
    });

    expect(result.order.status).toBe("partially-filled");
    expect(result.fills[0]?.quantity).toBe(5);
    expect(result.fills[0]?.price).toBeCloseTo(100.2);
  });

  it("can deterministically skip fills", async () => {
    const portfolio = new InMemoryPortfolioStore(10_000);
    const executor = new PaperOrderExecutor(portfolio, async () => 100, {
      feeRate: 0,
      slippageBps: 0,
      skipFillEvery: 2
    });

    await executor.placeOrder({
      symbol: "DEMO/USD",
      side: "buy",
      type: "market",
      quantity: 1,
      limitPrice: 100,
      reason: "first order fills",
      strategyId: "test-strategy"
    });
    const skipped = await executor.placeOrder({
      symbol: "DEMO/USD",
      side: "buy",
      type: "market",
      quantity: 1,
      limitPrice: 100,
      reason: "second order skips",
      strategyId: "test-strategy"
    });

    expect(skipped.order.status).toBe("cancelled");
    expect(skipped.fills).toHaveLength(0);
  });
});
