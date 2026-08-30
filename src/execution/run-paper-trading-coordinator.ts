import { randomUUID } from "node:crypto";
import { buildBreakEvenAudit } from "../dashboard/break-even-audit.js";
import { loadLiveOpsHistory, writeLiveOpsHistorySnapshot } from "../dashboard/live-ops-history.js";
import { loadLiveOpsSnapshotConfig } from "../dashboard/live-ops-snapshot.js";
import { AlpacaIexMarketDataClient } from "../feeds/alpaca-iex-market-data-client.js";
import { loadAlpacaIexMarketDataConfig } from "../feeds/alpaca-iex-config.js";
import { AlpacaCircuitBreaker } from "../feeds/alpaca-retry.js";
import { BasicRiskEngine } from "../risk/basic-risk-engine.js";
import { FileHeartbeatSink } from "../observability/file-heartbeat.js";
import { AllocationIntentMapper } from "../strategies/allocation-intent-mapper.js";
import { buildAllocationPolicy } from "../strategies/allocation-policy.js";
import { FixedNotionalIntentMapper } from "../strategies/fixed-notional-intent-mapper.js";
import { createDefaultStrategyRegistry } from "../strategies/registry.js";
import { AlpacaOrderExecutor } from "./alpaca-order-executor.js";
import { JournaledOrderExecutor } from "./journaled-order-executor.js";
import { loadAlpacaTradingConfig } from "./alpaca-trading-config.js";
import { regularUsEquitiesMarketSession } from "./market-session.js";
import { parsePaperCoordinatorArgs } from "./paper-trading-coordinator-cli.js";
import {
  runPaperTradingCoordinator,
  type PaperTradingCoordinatorRequest,
  type PaperTradingCoordinatorResult
} from "./paper-trading-coordinator.js";
import { SqlitePaperTradingStore } from "./sqlite-paper-trading-store.js";

const cli = parsePaperCoordinatorArgs(process.argv.slice(2));
const tradingConfig = loadAlpacaTradingConfig();
const marketDataConfig = loadAlpacaIexMarketDataConfig();
const snapshotConfig = loadLiveOpsSnapshotConfig();
const symbols = cli.symbols ?? marketDataConfig.symbols;
const orderExecutor = new AlpacaOrderExecutor(tradingConfig, fetch, {
  circuitBreaker: new AlpacaCircuitBreaker()
});
const stateStore = new SqlitePaperTradingStore(cli.statePath);
const leaseOwner = randomUUID();
const leaseTtlMs = Math.max(5 * 60_000, cli.iterations * cli.intervalMs + 5 * 60_000);
if (!stateStore.acquireLease("paper-coordinator", leaseOwner, new Date(), leaseTtlMs)) {
  stateStore.close();
  throw new Error("Another paper coordinator holds the SQLite execution lease.");
}
process.once("exit", () => {
  stateStore.releaseLease("paper-coordinator", leaseOwner);
  stateStore.close();
});
const journaledOrderExecutor = new JournaledOrderExecutor(orderExecutor, stateStore);
const heartbeat = new FileHeartbeatSink("reports/paper-trading-heartbeat.json");
await heartbeat.write({
  version: 1,
  service: "paper-coordinator",
  status: "starting",
  timestamp: new Date().toISOString(),
  ownerId: leaseOwner
});
const marketData = new AlpacaIexMarketDataClient(marketDataConfig, fetch, {
  circuitBreaker: new AlpacaCircuitBreaker()
});
const priorAudit = buildBreakEvenAudit(await loadLiveOpsHistory(cli.historyDir));
const initialAccountSnapshot = await orderExecutor.getAccountSnapshot();
const allocationPolicy =
  cli.sizingMode === "allocation"
    ? buildAllocationPolicy({
        symbols,
        defaultTargetAllocationPct: cli.targetAllocationPct,
        ...(cli.allocationWeights ? { allocationWeights: cli.allocationWeights } : {}),
        maxTotalAllocationPct: cli.maxTotalAllocationPct
      })
    : undefined;
const maxTargetAllocationPct =
  allocationPolicy === undefined
    ? cli.targetAllocationPct
    : Math.max(...Object.values(allocationPolicy.targetAllocationPctBySymbol));
const targetAllocationNotional = initialAccountSnapshot.equity * maxTargetAllocationPct;
const maxOrderNotional =
  cli.sizingMode === "allocation"
    ? Math.min(cli.maxOrderNotional, targetAllocationNotional)
    : cli.maxOrderNotional;
const coordinatorRequest: PaperTradingCoordinatorRequest = {
  symbols,
  iterations: cli.iterations,
  intervalMs: cli.intervalMs,
  strategy: createDefaultStrategyRegistry().create(cli.strategyId, cli.strategyParams),
  intentMapper:
    cli.sizingMode === "allocation"
      ? new AllocationIntentMapper({
          accountEquity: initialAccountSnapshot.equity,
          targetAllocationPct: cli.targetAllocationPct,
          ...(allocationPolicy
            ? { targetAllocationPctBySymbol: allocationPolicy.targetAllocationPctBySymbol }
            : {}),
          maxNotionalPerTrade: cli.maxOrderNotional,
          minNotionalPerTrade: cli.minNotionalPerTrade
        })
      : new FixedNotionalIntentMapper({ notionalPerTrade: cli.notionalPerTrade }),
  riskEngineFactory: (accountSnapshot) =>
    new BasicRiskEngine({
      maxOrderNotional,
      maxPositionNotional:
        cli.sizingMode === "allocation"
          ? Math.min(cli.maxPositionNotional, targetAllocationNotional)
          : cli.maxPositionNotional,
      maxDailyLossPct: snapshotConfig.maxDailyLoss / Math.max(accountSnapshot.equity, 1),
      blockHighImpactEventsAtOrAbove: 1,
      maxGrossLeverage: snapshotConfig.maxGrossExposurePct / 100
    }),
  broker: orderExecutor,
  orderExecutor: journaledOrderExecutor,
  marketData,
  snapshotConfig,
  priorBreakEvenAuditMet: priorAudit.allDaysMet,
  priorBreakEvenAuditDayCount: priorAudit.dayCount,
  maxCandleAgeMs: cli.maxCandleAgeMs,
  maxHistoryCandles: cli.maxHistoryCandles,
  maxExecutionsPerRun: cli.maxExecutionsPerRun,
  maxNotionalPerRun: cli.maxNotionalPerRun,
  dryRun: cli.dryRun,
  ...(cli.marketSessionMode === "regular"
    ? {
        marketSession: regularUsEquitiesMarketSession({
          timeZone: cli.marketSessionTimeZone,
          openTime: cli.marketSessionOpenTime,
          closeTime: cli.marketSessionCloseTime,
          holidays: cli.marketSessionHolidays
        })
      }
    : {}),
  stateStore,
  submissionJournal: stateStore,
  heartbeat: async (iteration, timestamp) => {
    if (!stateStore.acquireLease("paper-coordinator", leaseOwner, timestamp, leaseTtlMs)) {
      throw new Error("Paper coordinator lost its SQLite execution lease.");
    }
    await heartbeat.write({
      version: 1,
      service: "paper-coordinator",
      status: "running",
      timestamp: timestamp.toISOString(),
      ownerId: leaseOwner,
      detail: `iteration=${iteration + 1}`
    });
  }
};
let result: PaperTradingCoordinatorResult;
try {
  result = await runPaperTradingCoordinator(coordinatorRequest);
  await heartbeat.write({
    version: 1,
    service: "paper-coordinator",
    status: "completed",
    timestamp: new Date().toISOString(),
    ownerId: leaseOwner
  });
} catch (error) {
  await heartbeat.write({
    version: 1,
    service: "paper-coordinator",
    status: "failed",
    timestamp: new Date().toISOString(),
    ownerId: leaseOwner,
    detail: error instanceof Error ? error.message : String(error)
  });
  throw error;
}
const historyResult = await writeLiveOpsHistorySnapshot(result.liveOps, {
  historyDir: cli.historyDir,
  latestPath: cli.out
});

console.log(
  JSON.stringify(
    {
      runSummary: result.runSummary,
      cycles: result.cycles,
      executions: result.executions,
      liveOps: historyResult.latestSnapshot
    },
    null,
    2
  )
);
