import { describe, expect, it } from "vitest";
import { BasicRiskEngine } from "../src/risk/basic-risk-engine.js";

describe("BasicRiskEngine", () => {
  it("rejects oversized order notional", async () => {
    const engine = new BasicRiskEngine({
      maxOrderNotional: 1_000,
      maxPositionNotional: 5_000,
      maxDailyLossPct: 0.05,
      blockHighImpactEventsAtOrAbove: 10
    });

    const decision = await engine.evaluate(
      {
        symbol: "DEMO/USD",
        side: "buy",
        type: "market",
        quantity: 20,
        limitPrice: 100,
        reason: "test",
        strategyId: "test-strategy"
      },
      {
        mode: "paper",
        openPositions: [],
        recentEvents: [],
        dailyRealizedPnl: 0,
        accountEquity: 10_000,
        cash: 10_000,
        buyingPower: 10_000,
        now: new Date()
      }
    );

    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("exceeds max order notional");
  });

  it("blocks high-impact events", async () => {
    const engine = new BasicRiskEngine({
      maxOrderNotional: 1_000,
      maxPositionNotional: 5_000,
      maxDailyLossPct: 0.05,
      blockHighImpactEventsAtOrAbove: 8
    });

    const decision = await engine.evaluate(
      {
        symbol: "DEMO/USD",
        side: "buy",
        type: "market",
        quantity: 1,
        limitPrice: 100,
        reason: "test",
        strategyId: "test-strategy"
      },
      {
        mode: "paper",
        openPositions: [],
        recentEvents: [
          {
            id: "event-1",
            source: "calendar",
            eventType: "macro",
            headline: "Central bank decision",
            importance: 9,
            timestamp: new Date()
          }
        ],
        dailyRealizedPnl: 0,
        accountEquity: 10_000,
        cash: 10_000,
        buyingPower: 10_000,
        now: new Date()
      }
    );

    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("High-impact event");
  });

  it("rejects buys that exceed buying power", async () => {
    const engine = new BasicRiskEngine({
      maxOrderNotional: 20_000,
      maxPositionNotional: 20_000,
      maxDailyLossPct: 0.05,
      blockHighImpactEventsAtOrAbove: 10
    });

    const decision = await engine.evaluate(
      {
        symbol: "DEMO/USD",
        side: "buy",
        type: "market",
        quantity: 20,
        limitPrice: 100,
        reason: "test",
        strategyId: "test-strategy"
      },
      {
        mode: "paper",
        openPositions: [],
        recentEvents: [],
        dailyRealizedPnl: 0,
        accountEquity: 10_000,
        cash: 1_000,
        buyingPower: 1_000,
        now: new Date()
      }
    );

    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("exceeds buying power");
  });

  it("rejects short sells by default", async () => {
    const engine = new BasicRiskEngine({
      maxOrderNotional: 20_000,
      maxPositionNotional: 20_000,
      maxDailyLossPct: 0.05,
      blockHighImpactEventsAtOrAbove: 10
    });

    const decision = await engine.evaluate(
      {
        symbol: "DEMO/USD",
        side: "sell",
        type: "market",
        quantity: 5,
        limitPrice: 100,
        reason: "test",
        strategyId: "test-strategy"
      },
      {
        mode: "paper",
        openPositions: [],
        recentEvents: [],
        dailyRealizedPnl: 0,
        accountEquity: 10_000,
        cash: 10_000,
        buyingPower: 10_000,
        now: new Date()
      }
    );

    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain("short position");
  });
});
