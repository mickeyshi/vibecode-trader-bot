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
    const asOf = new Date("2026-09-18T20:00:00Z");
    const plan = new EtfRelativeMomentumAllocator().allocate({
      closeHistoryBySymbol: new Map([["QQQ", rising(260, 0.002)]]),
      asOf,
      recentEvents: [
        {
          id: "n1",
          source: "test",
          eventType: "news",
          symbol: "QQQ",
          headline: "event",
          sentiment: "negative",
          importance: 9,
          timestamp: new Date("2026-09-18T19:00:00Z")
        }
      ]
    });
    expect(plan.targets).toEqual([]);
    expect(plan.blockedSymbols).toEqual(["QQQ"]);
  });

  it("ignores future and stale events at the point-in-time boundary", () => {
    const allocator = new EtfRelativeMomentumAllocator();
    const base = {
      closeHistoryBySymbol: new Map([["QQQ", rising(260, 0.002)]]),
      asOf: new Date("2026-09-18T20:00:00Z")
    };
    for (const timestamp of ["2026-09-19T12:00:00Z", "2026-09-10T12:00:00Z"]) {
      const plan = allocator.allocate({
        ...base,
        recentEvents: [negativeEvent("event", timestamp)]
      });
      expect(plan.blockedSymbols).toEqual([]);
      expect(plan.targets.map((target) => target.symbol)).toContain("QQQ");
    }
  });

  it("requires asOf and deduplicates normalized story identity", () => {
    const allocator = new EtfRelativeMomentumAllocator();
    const recentEvents = [
      negativeEvent("  Issuer   warning ", "2026-09-18T18:00:00Z"),
      negativeEvent("issuer warning", "2026-09-18T19:00:00Z")
    ];
    expect(() =>
      allocator.allocate({
        closeHistoryBySymbol: new Map([["QQQ", rising(260, 0.002)]]),
        recentEvents
      })
    ).toThrow("explicit asOf");
    const plan = allocator.allocate({
      closeHistoryBySymbol: new Map([["QQQ", rising(260, 0.002)]]),
      asOf: new Date("2026-09-18T20:00:00Z"),
      recentEvents
    });
    expect(plan.blockedSymbols).toEqual(["QQQ"]);
  });
});

function negativeEvent(headline: string, timestamp: string) {
  return {
    id: `${headline}-${timestamp}`,
    source: "test",
    eventType: "news" as const,
    symbol: "QQQ",
    headline,
    sentiment: "negative" as const,
    importance: 9,
    timestamp: new Date(timestamp)
  };
}

function rising(count: number, slope: number): number[] {
  return Array.from({ length: count }, (_, index) => 100 * (1 + slope) ** index);
}
