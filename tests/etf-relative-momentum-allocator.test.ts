import { describe, expect, it } from "vitest";
import { EtfRelativeMomentumAllocator } from "../src/portfolio/etf-relative-momentum-allocator.js";

describe("EtfRelativeMomentumAllocator", () => {
  it("returns bounded weights and retains cash", () => {
    const plan = new EtfRelativeMomentumAllocator().allocate({
      closeHistoryBySymbol: new Map([
        ["SPY", rising(260, 0.001)],
        ["QQQ", rising(260, 0.002)],
        ["IEF", rising(260, -0.0001)]
      ])
    });
    expect(plan.targets.map((target) => target.symbol)).toContain("QQQ");
    expect(plan.targets.every((target) => target.targetWeight <= 0.4)).toBe(true);
    expect(plan.grossWeight).toBeLessThanOrEqual(0.8);
    expect(plan.cashWeight).toBeCloseTo(1 - plan.grossWeight);
  });

  it("uses negative high-importance news only as an allocation veto", () => {
    const plan = new EtfRelativeMomentumAllocator().allocate({
      closeHistoryBySymbol: new Map([["QQQ", rising(260, 0.002)]]),
      recentEvents: [
        {
          id: "n1",
          source: "test",
          eventType: "news",
          symbol: "QQQ",
          headline: "event",
          sentiment: "negative",
          importance: 9,
          timestamp: new Date()
        }
      ]
    });
    expect(plan.targets).toEqual([]);
    expect(plan.blockedSymbols).toEqual(["QQQ"]);
  });
});

function rising(count: number, slope: number): number[] {
  return Array.from({ length: count }, (_, index) => 100 * (1 + slope) ** index);
}
