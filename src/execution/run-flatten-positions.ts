import { buildBreakEvenAudit } from "../dashboard/break-even-audit.js";
import { loadLiveOpsHistory, writeLiveOpsHistorySnapshot } from "../dashboard/live-ops-history.js";
import { buildLiveOpsSnapshot, loadLiveOpsSnapshotConfig } from "../dashboard/live-ops-snapshot.js";
import type { LiveOpsOrderRow } from "../dashboard/live-ops-view-model.js";
import { AlpacaOrderExecutor } from "./alpaca-order-executor.js";
import { loadAlpacaTradingConfig } from "./alpaca-trading-config.js";
import { flattenOpenPositions } from "./flatten-positions.js";
import type { ExecutionResult } from "./interfaces.js";
import { TradingGateway } from "./trading-gateway.js";

const cli = parseArgs(process.argv.slice(2));
const tradingConfig = loadAlpacaTradingConfig();
const snapshotConfig = loadLiveOpsSnapshotConfig();
const orderExecutor = new AlpacaOrderExecutor(tradingConfig);
const accountSnapshot = await orderExecutor.getAccountSnapshot();
const positions = await orderExecutor.getOpenPositions();
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
const flattenResult = await flattenOpenPositions(positions, gateway);
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
  flattenResult.executions.map(toOrderRow)
);
const historyResult = await writeLiveOpsHistorySnapshot(liveOpsSnapshot, {
  historyDir: cli.historyDir,
  latestPath: cli.out
});

console.log(
  JSON.stringify(
    {
      flatten: flattenResult,
      liveOps: historyResult.latestSnapshot
    },
    null,
    2
  )
);

interface FlattenCli {
  out: string;
  historyDir: string;
}

function parseArgs(args: string[]): FlattenCli {
  return {
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

function toOrderRow(result: ExecutionResult): LiveOpsOrderRow {
  return {
    id: result.order.id,
    timestamp: result.order.updatedAt.toISOString(),
    strategyId: result.order.intent.strategyId,
    symbol: result.order.intent.symbol,
    side: result.order.intent.side,
    quantity: result.order.intent.quantity,
    status: result.order.status,
    reason: result.order.intent.reason,
    ...(result.order.intent.limitPrice !== undefined
      ? { limitPrice: result.order.intent.limitPrice }
      : {})
  };
}
