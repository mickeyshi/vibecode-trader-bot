import { describe, expect, it } from "vitest";
import { buildEtfResearchViewModel } from "../src/dashboard/etf-research-view-model.js";

describe("ETF research dashboard view model", () => {
  it("normalizes a research-only scenario", () => {
    const view = buildEtfResearchViewModel(report());
    expect(view.results).toHaveLength(1);
    expect(view.results[0]?.result.strategy.totalReturnPct).toBe(4);
  });

  it("rejects executable or malformed research artifacts", () => {
    expect(() => buildEtfResearchViewModel({ ...report(), researchOnly: false })).toThrow(
      "research-only"
    );
    const malformed = report();
    malformed.results[0]!.result.strategy.totalReturnPct = Number.NaN;
    expect(() => buildEtfResearchViewModel(malformed)).toThrow("finite number");
  });
});

function report() {
  const performance = {
    totalReturnPct: 4,
    sharpeRatio: 0.5,
    maxDrawdownPct: 2,
    turnover: 3,
    annualReturnsPct: { "2025": 4 },
    symbolContributionPct: { SPY: 4 },
    regimeContributionPct: { "risk-on": 4 }
  };
  return {
    researchOnly: true,
    dataProvenance: {
      source: "Alpaca IEX historical bars",
      adjustment: "all",
      requestedAt: "2026-09-20T00:00:00Z"
    },
    benchmarkDefinition: {
      symbol: "SPY",
      grossWeight: 0.8,
      interpretation: "Provider-adjusted proxy."
    },
    results: [
      {
        configuration: {
          momentumWindow: 126,
          trendWindow: 200,
          transactionCostBps: 10,
          rebalanceDelaySessions: 0,
          skipEveryNthRebalance: 0,
          cashAnnualYieldPct: 0
        },
        result: {
          firstDate: "2025-01-01",
          lastDate: "2025-12-31",
          strategy: { ...performance },
          benchmark: { ...performance }
        }
      }
    ]
  };
}
