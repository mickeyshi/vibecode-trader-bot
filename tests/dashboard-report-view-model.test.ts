import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadDashboardReport } from "../src/dashboard/report-loader.js";
import { buildDashboardReportViewModel } from "../src/dashboard/report-view-model.js";

describe("dashboard report view model", () => {
  it("normalizes a single backtest report", () => {
    const viewModel = buildDashboardReportViewModel(makeReport("momentum"), "reports/run.json");

    expect(viewModel.kind).toBe("single");
    expect(viewModel.sourcePath).toBe("reports/run.json");
    expect(viewModel.reportCount).toBe(1);
    expect(viewModel.runs[0]).toMatchObject({
      strategyId: "momentum",
      endingEquity: 10_125,
      orderCount: 1,
      fillCount: 1,
      alertCount: 1,
      dataQualityWarningCount: 1
    });
    expect(viewModel.equitySeries[0]?.points).toHaveLength(2);
    expect(viewModel.alerts[0]).toMatchObject({
      strategyId: "momentum",
      symbol: "DEMO/USD",
      type: "risk-rejection"
    });
    expect(viewModel.decisionTraces[0]).toMatchObject({
      strategyId: "momentum",
      action: "buy",
      hasIntent: true,
      riskApproved: true,
      orderStatus: "filled"
    });
  });

  it("normalizes comparison reports with rankings and metadata", () => {
    const viewModel = buildDashboardReportViewModel({
      rankings: [
        {
          rank: 1,
          strategyId: "momentum",
          score: 3.5,
          totalReturnPct: 2,
          maxDrawdownPct: 1,
          profitFactor: null,
          closedTradeCount: 0,
          dataQualityWarningCount: 0,
          reason: "test ranking"
        }
      ],
      strategyMetadata: [
        {
          id: "momentum",
          name: "Momentum",
          description: "Test strategy.",
          category: "momentum",
          defaultParams: { lookbackWindow: 5 },
          tags: ["momentum"]
        }
      ],
      reports: [makeReport("momentum"), makeReport("buy-and-hold")]
    });

    expect(viewModel.kind).toBe("comparison");
    expect(viewModel.reportCount).toBe(2);
    expect(viewModel.rankings[0]?.strategyId).toBe("momentum");
    expect(viewModel.strategyMetadata[0]).toMatchObject({
      id: "momentum",
      name: "Momentum"
    });
    expect(viewModel.runs.map((run) => run.strategyId)).toEqual(["momentum", "buy-and-hold"]);
    expect(viewModel.equitySeries).toHaveLength(2);
  });

  it("loads a dashboard report from JSON", async () => {
    await mkdir("reports", { recursive: true });
    await writeFile(
      "reports/test-dashboard-report.json",
      JSON.stringify(makeReport("mean-reversion")),
      "utf8"
    );

    const viewModel = await loadDashboardReport("reports/test-dashboard-report.json");

    expect(viewModel.kind).toBe("single");
    expect(viewModel.sourcePath).toBe("reports/test-dashboard-report.json");
    expect(viewModel.runs[0]?.strategyId).toBe("mean-reversion");
  });

  it("rejects malformed report JSON", () => {
    expect(() => buildDashboardReportViewModel({ strategyId: "missing-fields" })).toThrow(
      "metrics must be an object"
    );
  });
});

function makeReport(strategyId: string): Record<string, unknown> {
  return {
    strategyId,
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-02T00:00:00.000Z",
    endingEquity: 10_125,
    totalReturnPct: 1.25,
    maxDrawdownPct: 0.5,
    orders: [
      {
        id: "order-1",
        intent: {
          symbol: "DEMO/USD",
          side: "buy",
          type: "market",
          quantity: 1,
          strategyId
        },
        status: "filled",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    fills: [
      {
        orderId: "order-1",
        symbol: "DEMO/USD",
        side: "buy",
        quantity: 1,
        price: 100,
        fee: 1,
        timestamp: "2026-01-01T00:00:00.000Z"
      }
    ],
    trades: [],
    riskRejections: [],
    equityCurve: [
      { timestamp: "2026-01-01T00:00:00.000Z", equity: 10_000 },
      { timestamp: "2026-01-02T00:00:00.000Z", equity: 10_125 }
    ],
    metrics: {
      startingEquity: 10_000,
      endingEquity: 10_125,
      endingCash: 9_000,
      finalPositionValue: 1_125,
      finalGrossExposure: 1_125,
      finalRealizedPnl: 0,
      finalUnrealizedPnl: 125,
      netProfit: 125,
      totalFees: 1,
      filledOrderCount: 1,
      skippedOrderCount: 0,
      closedTradeCount: 0,
      winningTradeCount: 0,
      losingTradeCount: 0,
      winRatePct: 0,
      grossProfit: 0,
      grossLoss: 0,
      profitFactor: null
    },
    observabilityMetrics: [],
    decisionTraces: [
      {
        id: "trace-1",
        timestamp: "2026-01-01T00:00:00.000Z",
        symbol: "DEMO/USD",
        strategyId,
        signal: {
          action: "buy",
          confidence: 1,
          reason: "test signal"
        },
        intent: {
          symbol: "DEMO/USD",
          side: "buy",
          type: "market",
          quantity: 1,
          strategyId
        },
        riskDecision: {
          approved: true,
          reason: "approved",
          appliedRules: ["test-rule"]
        },
        order: {
          id: "order-1",
          status: "filled"
        },
        fillCount: 1,
        equity: 10_125
      }
    ],
    logs: [],
    alerts: [
      {
        id: "alert-1",
        timestamp: "2026-01-01T00:00:00.000Z",
        severity: "warning",
        type: "risk-rejection",
        message: "test alert",
        context: {
          strategyId,
          symbol: "DEMO/USD"
        }
      }
    ],
    dataQualityWarnings: [
      {
        type: "missing-data-gap",
        symbol: "DEMO/USD",
        calendar: "weekday",
        previousTimestamp: "2026-01-01T00:00:00.000Z",
        currentTimestamp: "2026-01-02T00:00:00.000Z",
        gapDays: 1,
        missingSessionCount: 1,
        message: "test gap"
      }
    ],
    assumptions: ["test assumption"]
  };
}
