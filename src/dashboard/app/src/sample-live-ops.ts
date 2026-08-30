import { buildLiveOpsDashboardViewModel } from "../../live-ops-view-model.js";
import { buildTradingGatewayReadiness } from "../../../execution/trading-gateway.js";

const gatewayReadiness = buildTradingGatewayReadiness({
  requestedMode: "paper",
  liveTradingEnabled: false,
  operatorConfirmedLive: false,
  killSwitchArmed: true,
  maxDailyLossBreached: false,
  brokerCredentialsConfigured: false,
  requirePriorBreakEvenAudit: false,
  stopAfterBreakEven: true,
  breakEvenTargetMet: false
});

export const sampleLiveOpsDashboard = buildLiveOpsDashboardViewModel({
  mode: gatewayReadiness.mode,
  executable: gatewayReadiness.executable,
  updatedAt: "2026-06-19T14:30:00.000Z",
  startingEquity: 10_000,
  feesPaidToday: 2.85,
  account: {
    equity: 10_001.46,
    cash: 8_742.19,
    buyingPower: 8_742.19,
    grossExposure: 1_261.54,
    dayRealizedPnl: 1.2,
    dayUnrealizedPnl: 0.26,
    currency: "USD"
  },
  tradingControls: [
    {
      id: "execution-mode",
      label: "Execution",
      value: "Paper trading",
      status: "warning"
    },
    {
      id: "kill-switch",
      label: "Kill switch",
      value: "Armed",
      status: "ready"
    },
    {
      id: "daily-target",
      label: "Day target",
      value: "Break even after fees",
      status: "ready"
    }
  ],
  riskLimits: [
    {
      label: "Daily loss",
      used: 0,
      limit: 100,
      unit: "currency",
      status: "ready"
    },
    {
      label: "Order notional",
      used: 250,
      limit: 500,
      unit: "currency",
      status: "ready"
    },
    {
      label: "Gross exposure",
      used: 12.6,
      limit: 25,
      unit: "percent",
      status: "ready"
    }
  ],
  positions: [
    {
      symbol: "SPY",
      quantity: 3,
      averageEntryPrice: 420.1,
      markPrice: 420.51,
      unrealizedPnl: 1.23,
      exposure: 1_261.54
    }
  ],
  orders: [
    {
      id: "paper-4",
      timestamp: "2026-06-19T14:28:00.000Z",
      strategyId: "moving-average-crossover",
      symbol: "SPY",
      side: "buy",
      quantity: 1,
      limitPrice: 420.5,
      status: "filled",
      reason: "Trend continuation signal cleared risk checks."
    },
    {
      id: "paper-3",
      timestamp: "2026-06-19T14:02:00.000Z",
      strategyId: "mean-reversion",
      symbol: "SPY",
      side: "sell",
      quantity: 1,
      limitPrice: 421.15,
      status: "rejected",
      reason: "Would reduce below configured minimum inventory."
    }
  ],
  paperRun: {
    dryRun: false,
    submittedNotional: 250,
    maxNotionalPerRun: 500,
    executionCount: 2,
    maxExecutionsPerRun: 5,
    skippedCount: 1
  },
  paperCycles: [
    {
      id: "paper-cycle-1-SPY",
      timestamp: "2026-06-19T14:28:00.000Z",
      strategyId: "moving-average-crossover",
      symbol: "SPY",
      action: "buy",
      confidence: 0.72,
      reason: "Short MA crossed above long MA.",
      status: "submitted",
      riskApproved: true,
      orderStatus: "filled"
    },
    {
      id: "paper-cycle-2-AAPL",
      timestamp: "2026-06-19T14:29:00.000Z",
      strategyId: "moving-average-crossover",
      symbol: "AAPL",
      action: "hold",
      confidence: 0,
      reason: "Not enough candles.",
      status: "skipped",
      skippedReason: "Strategy did not produce an order intent."
    }
  ],
  readinessChecks: [
    ...gatewayReadiness.gates,
    {
      id: "market-data",
      label: "Market data",
      detail: "Alpaca IEX data configuration is available for ingestion.",
      status: "ready"
    }
  ],
  breakEvenAudit: {
    dayCount: 3,
    metCount: 2,
    missedCount: 1,
    currentStreak: 2,
    longestStreak: 2,
    allDaysMet: false
  }
});
