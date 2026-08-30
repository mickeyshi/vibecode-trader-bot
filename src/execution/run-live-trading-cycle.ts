import { writeLiveOpsHistorySnapshot } from "../dashboard/live-ops-history.js";
import { buildBreakEvenAudit } from "../dashboard/break-even-audit.js";
import { loadLiveOpsHistory } from "../dashboard/live-ops-history.js";
import { buildLiveOpsSnapshot, loadLiveOpsSnapshotConfig } from "../dashboard/live-ops-snapshot.js";
import { AlpacaIexMarketDataClient } from "../feeds/alpaca-iex-market-data-client.js";
import { loadAlpacaIexMarketDataConfig } from "../feeds/alpaca-iex-config.js";
import { BasicRiskEngine } from "../risk/basic-risk-engine.js";
import { FixedNotionalIntentMapper } from "../strategies/fixed-notional-intent-mapper.js";
import { createDefaultStrategyRegistry } from "../strategies/registry.js";
import { AlpacaOrderExecutor } from "./alpaca-order-executor.js";
import { loadAlpacaTradingConfig } from "./alpaca-trading-config.js";
import { liveTradingCycleOrderRows, runLiveTradingCycle } from "./live-trading-cycle.js";
import { TradingGateway } from "./trading-gateway.js";

const cli = parseArgs(process.argv.slice(2));
const tradingConfig = loadAlpacaTradingConfig();
const marketDataConfig = loadAlpacaIexMarketDataConfig();
const snapshotConfig = loadLiveOpsSnapshotConfig();
const symbol = cli.symbol ?? marketDataConfig.symbols[0] ?? "SPY";
const orderExecutor = new AlpacaOrderExecutor(tradingConfig);
const accountSnapshot = await orderExecutor.getAccountSnapshot();
const positions = await orderExecutor.getOpenPositions();
const candles = await new AlpacaIexMarketDataClient(marketDataConfig).getLatestBars([symbol]);
const strategy = createDefaultStrategyRegistry().create(cli.strategyId);
const priorAudit = buildBreakEvenAudit(await loadLiveOpsHistory(cli.historyDir));
const gateway = new TradingGateway(orderExecutor, {
  requestedMode: tradingConfig.mode,
  liveTradingEnabled: snapshotConfig.liveTradingEnabled,
  operatorConfirmedLive: snapshotConfig.operatorConfirmedLive,
  killSwitchArmed: snapshotConfig.killSwitchArmed,
  maxDailyLossBreached: accountSnapshot.realizedPnl <= -snapshotConfig.maxDailyLoss,
  brokerCredentialsConfigured: snapshotConfig.brokerCredentialsConfigured,
  stopAfterBreakEven: snapshotConfig.stopAfterBreakEven,
  breakEvenTargetMet:
    accountSnapshot.equity >= snapshotConfig.dayStartingEquity + snapshotConfig.dayFeesPaid,
  requirePriorBreakEvenAudit: snapshotConfig.requirePriorBreakEvenAudit,
  priorBreakEvenAuditMet: priorAudit.allDaysMet,
  priorBreakEvenAuditDayCount: priorAudit.dayCount,
  allowBreakEvenExitOrders: true,
  openPositions: positions
});
const cycleResult = await runLiveTradingCycle({
  symbol,
  mode: tradingConfig.mode,
  strategy,
  intentMapper: new FixedNotionalIntentMapper({ notionalPerTrade: cli.notionalPerTrade }),
  riskEngine: new BasicRiskEngine({
    maxOrderNotional: cli.maxOrderNotional,
    maxPositionNotional: cli.maxPositionNotional,
    maxDailyLossPct: snapshotConfig.maxDailyLoss / Math.max(accountSnapshot.equity, 1),
    blockHighImpactEventsAtOrAbove: 1,
    maxGrossLeverage: snapshotConfig.maxGrossExposurePct / 100
  }),
  executor: gateway,
  accountSnapshot,
  candles,
  positions
});
const refreshedAccountSnapshot = await orderExecutor.getAccountSnapshot();
const refreshedPositions = await orderExecutor.getOpenPositions();
const liveOpsSnapshot = buildLiveOpsSnapshot(
  refreshedAccountSnapshot,
  snapshotConfig,
  refreshedPositions.map((position) => ({
    symbol: position.symbol,
    quantity: position.quantity,
    averageEntryPrice: position.averageEntryPrice,
    markPrice: position.markPrice,
    unrealizedPnl: position.unrealizedPnl,
    exposure: Math.abs(position.quantity * position.markPrice)
  })),
  liveTradingCycleOrderRows(cycleResult)
);
const output = {
  cycle: cycleResult,
  liveOps: liveOpsSnapshot
};

const historyResult = await writeLiveOpsHistorySnapshot(liveOpsSnapshot, {
  historyDir: cli.historyDir,
  latestPath: cli.out
});
const json = JSON.stringify({ ...output, liveOps: historyResult.latestSnapshot }, null, 2);

console.log(json);

interface LiveCycleCli {
  symbol?: string;
  strategyId: string;
  notionalPerTrade: number;
  maxOrderNotional: number;
  maxPositionNotional: number;
  out: string;
  historyDir: string;
}

function parseArgs(args: string[]): LiveCycleCli {
  const symbol = readOption(args, "--symbol");

  return {
    ...(symbol ? { symbol } : {}),
    strategyId: readOption(args, "--strategy") ?? "buy-and-hold",
    notionalPerTrade: numberOption(args, "--notional", 25),
    maxOrderNotional: numberOption(args, "--max-order-notional", 50),
    maxPositionNotional: numberOption(args, "--max-position-notional", 250),
    out: readOption(args, "--out") ?? "reports/live-ops-snapshot.json",
    historyDir: readOption(args, "--history-dir") ?? "reports/live-ops-history"
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function numberOption(args: string[], name: string, fallback: number): number {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }

  return value;
}
