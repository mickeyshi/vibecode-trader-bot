import { buildDashboardReportViewModel } from "../../report-view-model.js";

const sampleReport = {
  rankings: [
    {
      rank: 1,
      strategyId: "moving-average-crossover",
      score: 0.7,
      totalReturnPct: 0.99,
      maxDrawdownPct: 0.29,
      profitFactor: null,
      closedTradeCount: 0,
      dataQualityWarningCount: 0,
      reason:
        "return 0.99%; drawdown 0.29%; profit factor bonus 0; closed trade bonus 0; data-quality penalty 0"
    },
    {
      rank: 2,
      strategyId: "buy-and-hold",
      score: 0.57,
      totalReturnPct: 0.78,
      maxDrawdownPct: 0.22,
      profitFactor: null,
      closedTradeCount: 0,
      dataQualityWarningCount: 0,
      reason:
        "return 0.78%; drawdown 0.22%; profit factor bonus 0; closed trade bonus 0; data-quality penalty 0"
    }
  ],
  strategyMetadata: [
    {
      id: "moving-average-crossover",
      name: "Moving Average Crossover",
      description: "Buys when short moving average is above long moving average; sells below it.",
      category: "trend",
      defaultParams: {
        shortWindow: 3,
        longWindow: 5,
        minConfidence: 0.01
      },
      tags: ["trend-following", "moving-average", "long-only"]
    },
    {
      id: "buy-and-hold",
      name: "Buy and Hold",
      description: "Baseline strategy that buys once and holds the long position.",
      category: "baseline",
      defaultParams: {
        targetAllocationPct: 1
      },
      tags: ["baseline", "long-only"]
    }
  ],
  reports: [
    makeReport("moving-average-crossover", 10_099.33, 0.99, 0.29, 4, 4, 2, 2),
    makeReport("buy-and-hold", 10_078.5, 0.78, 0.22, 1, 1, 0, 0)
  ]
};

export const sampleDashboardReport = buildDashboardReportViewModel(sampleReport, "sample-report");

function makeReport(
  strategyId: string,
  endingEquity: number,
  totalReturnPct: number,
  maxDrawdownPct: number,
  orderCount: number,
  fillCount: number,
  riskRejectionCount: number,
  alertCount: number
): Record<string, unknown> {
  const equityCurve = [10_000, 10_030, 10_020, endingEquity].map((equity, index) => ({
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    equity
  }));

  return {
    strategyId,
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-01-04T00:00:00.000Z",
    endingEquity,
    totalReturnPct,
    maxDrawdownPct,
    orders: Array.from({ length: orderCount }, (_, index) => ({
      id: `${strategyId}-order-${index + 1}`,
      intent: {
        symbol: "DEMO/USD",
        side: index % 2 === 0 ? "buy" : "sell",
        type: "market",
        quantity: 1,
        strategyId
      },
      status: "filled",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })),
    fills: Array.from({ length: fillCount }, (_, index) => ({
      orderId: `${strategyId}-order-${index + 1}`,
      symbol: "DEMO/USD",
      side: index % 2 === 0 ? "buy" : "sell",
      quantity: 1,
      price: 100 + index,
      fee: 1,
      timestamp: "2026-01-01T00:00:00.000Z"
    })),
    trades: [],
    riskRejections: Array.from({ length: riskRejectionCount }, () => ({
      intent: {
        symbol: "DEMO/USD",
        side: "buy",
        type: "market",
        quantity: 10,
        strategyId
      },
      reason: "Projected position notional exceeds max position notional.",
      appliedRules: ["max-position-notional"],
      timestamp: "2026-01-01T00:00:00.000Z"
    })),
    equityCurve,
    metrics: {
      startingEquity: 10_000,
      endingEquity,
      endingCash: 8_000,
      finalPositionValue: endingEquity - 8_000,
      finalGrossExposure: endingEquity - 8_000,
      finalRealizedPnl: 0,
      finalUnrealizedPnl: endingEquity - 10_000,
      netProfit: endingEquity - 10_000,
      totalFees: fillCount,
      filledOrderCount: fillCount,
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
    decisionTraces: equityCurve.map((point, index) => ({
      id: `${strategyId}-trace-${index + 1}`,
      timestamp: point.timestamp,
      symbol: "DEMO/USD",
      strategyId,
      signal: {
        action: index === 0 ? "buy" : "hold",
        confidence: index === 0 ? 0.82 : 0,
        reason: index === 0 ? "Sample entry signal." : "No new action."
      },
      ...(index === 0
        ? {
            intent: {
              symbol: "DEMO/USD",
              side: "buy",
              type: "market",
              quantity: 1,
              strategyId
            },
            riskDecision: {
              approved: true,
              reason: "Approved by basic risk rules.",
              appliedRules: ["max-order-notional"]
            },
            order: {
              id: `${strategyId}-order-1`,
              status: "filled"
            }
          }
        : {}),
      fillCount: index === 0 ? 1 : 0,
      equity: point.equity
    })),
    logs: [],
    alerts: Array.from({ length: alertCount }, (_, index) => ({
      id: `${strategyId}-alert-${index + 1}`,
      timestamp: "2026-01-01T00:00:00.000Z",
      severity: "warning",
      type: "risk-rejection",
      message: "Sample risk rejection alert.",
      context: {
        strategyId,
        symbol: "DEMO/USD"
      }
    })),
    dataQualityWarnings: [],
    assumptions: ["Sample dashboard report."]
  };
}
