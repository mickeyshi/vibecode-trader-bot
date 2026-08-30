import type { AccountSnapshot } from "../portfolio/interfaces.js";
import {
  buildTradingGatewayReadiness,
  type TradingGatewayConfig
} from "../execution/trading-gateway.js";
import {
  buildLiveOpsDashboardFromAccountSnapshot,
  type LiveOpsDashboardViewModel,
  type LiveOpsOrderRow,
  type LiveOpsPaperCycleRow,
  type LiveOpsPaperRunSummary,
  type LiveOpsPositionRow
} from "./live-ops-view-model.js";

export interface LiveOpsSnapshotConfig {
  mode: TradingGatewayConfig["requestedMode"];
  dayStartingEquity: number;
  dayFeesPaid: number;
  maxDailyLoss: number;
  maxGrossExposurePct: number;
  liveTradingEnabled: boolean;
  operatorConfirmedLive: boolean;
  killSwitchArmed: boolean;
  stopAfterBreakEven: boolean;
  brokerCredentialsConfigured: boolean;
  requirePriorBreakEvenAudit: boolean;
}

export interface LiveOpsSnapshotEnv {
  ALPACA_TRADING_MODE?: string;
  LIVE_OPS_DAY_STARTING_EQUITY?: string;
  LIVE_OPS_DAY_FEES_PAID?: string;
  LIVE_OPS_MAX_DAILY_LOSS?: string;
  LIVE_OPS_MAX_GROSS_EXPOSURE_PCT?: string;
  LIVE_TRADING_ENABLED?: string;
  LIVE_OPERATOR_CONFIRMED?: string;
  LIVE_KILL_SWITCH_ARMED?: string;
  LIVE_STOP_AFTER_BREAK_EVEN?: string;
  LIVE_REQUIRE_PRIOR_BREAK_EVEN_AUDIT?: string;
  ALPACA_TRADING_API_KEY_ID?: string;
  ALPACA_TRADING_API_SECRET_KEY?: string;
}

export function buildLiveOpsSnapshot(
  accountSnapshot: AccountSnapshot,
  config: LiveOpsSnapshotConfig,
  positions: LiveOpsPositionRow[] = [],
  orders: LiveOpsOrderRow[] = [],
  paperRun?: LiveOpsPaperRunSummary,
  paperCycles?: LiveOpsPaperCycleRow[]
): LiveOpsDashboardViewModel {
  const breakEvenTargetMet =
    accountSnapshot.equity >= config.dayStartingEquity + config.dayFeesPaid;
  const dailyLossBreached = accountSnapshot.realizedPnl <= -config.maxDailyLoss;
  const grossExposurePct =
    accountSnapshot.equity > 0 ? (accountSnapshot.grossExposure / accountSnapshot.equity) * 100 : 0;
  const gatewayReadiness = buildTradingGatewayReadiness({
    requestedMode: config.mode,
    liveTradingEnabled: config.liveTradingEnabled,
    operatorConfirmedLive: config.operatorConfirmedLive,
    killSwitchArmed: config.killSwitchArmed,
    maxDailyLossBreached: dailyLossBreached,
    brokerCredentialsConfigured: config.brokerCredentialsConfigured,
    stopAfterBreakEven: config.stopAfterBreakEven,
    breakEvenTargetMet,
    requirePriorBreakEvenAudit: config.requirePriorBreakEvenAudit
  });

  return buildLiveOpsDashboardFromAccountSnapshot({
    mode: gatewayReadiness.mode,
    executable: gatewayReadiness.executable,
    accountSnapshot,
    dayStartingEquity: config.dayStartingEquity,
    dayFeesPaid: config.dayFeesPaid,
    tradingControls: [
      {
        id: "execution-mode",
        label: "Execution",
        value: gatewayReadiness.mode === "live" ? "Live trading" : "Paper trading",
        status: gatewayReadiness.mode === "live" ? gatewayReadiness.status : "warning"
      },
      {
        id: "kill-switch",
        label: "Kill switch",
        value: config.killSwitchArmed ? "Armed" : "Disarmed",
        status: config.killSwitchArmed ? "ready" : "blocked"
      },
      {
        id: "daily-target",
        label: "Day target",
        value: config.stopAfterBreakEven ? "Lock after break even" : "Monitor break even",
        status: config.stopAfterBreakEven ? "ready" : "warning"
      }
    ],
    riskLimits: [
      {
        label: "Daily loss",
        used: Math.max(0, -accountSnapshot.realizedPnl),
        limit: config.maxDailyLoss,
        unit: "currency",
        status: dailyLossBreached ? "blocked" : "ready"
      },
      {
        label: "Gross exposure",
        used: grossExposurePct,
        limit: config.maxGrossExposurePct,
        unit: "percent",
        status: grossExposurePct > config.maxGrossExposurePct ? "blocked" : "ready"
      }
    ],
    positions,
    orders,
    ...(paperCycles ? { paperCycles } : {}),
    readinessChecks: gatewayReadiness.gates,
    ...(paperRun ? { paperRun } : {})
  });
}

export function loadLiveOpsSnapshotConfig(
  env: LiveOpsSnapshotEnv = process.env
): LiveOpsSnapshotConfig {
  return {
    mode: parseMode(env.ALPACA_TRADING_MODE ?? "paper"),
    dayStartingEquity: numberEnv(env.LIVE_OPS_DAY_STARTING_EQUITY, "LIVE_OPS_DAY_STARTING_EQUITY"),
    dayFeesPaid: numberEnv(env.LIVE_OPS_DAY_FEES_PAID ?? "0", "LIVE_OPS_DAY_FEES_PAID"),
    maxDailyLoss: numberEnv(env.LIVE_OPS_MAX_DAILY_LOSS ?? "100", "LIVE_OPS_MAX_DAILY_LOSS"),
    maxGrossExposurePct: numberEnv(
      env.LIVE_OPS_MAX_GROSS_EXPOSURE_PCT ?? "25",
      "LIVE_OPS_MAX_GROSS_EXPOSURE_PCT"
    ),
    liveTradingEnabled: booleanEnv(env.LIVE_TRADING_ENABLED ?? "false", "LIVE_TRADING_ENABLED"),
    operatorConfirmedLive: booleanEnv(
      env.LIVE_OPERATOR_CONFIRMED ?? "false",
      "LIVE_OPERATOR_CONFIRMED"
    ),
    killSwitchArmed: booleanEnv(env.LIVE_KILL_SWITCH_ARMED ?? "true", "LIVE_KILL_SWITCH_ARMED"),
    stopAfterBreakEven: booleanEnv(
      env.LIVE_STOP_AFTER_BREAK_EVEN ?? "true",
      "LIVE_STOP_AFTER_BREAK_EVEN"
    ),
    requirePriorBreakEvenAudit: booleanEnv(
      env.LIVE_REQUIRE_PRIOR_BREAK_EVEN_AUDIT ?? "false",
      "LIVE_REQUIRE_PRIOR_BREAK_EVEN_AUDIT"
    ),
    brokerCredentialsConfigured: Boolean(
      env.ALPACA_TRADING_API_KEY_ID && env.ALPACA_TRADING_API_SECRET_KEY
    )
  };
}

function parseMode(raw: string): LiveOpsSnapshotConfig["mode"] {
  const mode = raw.trim().toLowerCase();
  if (mode === "paper" || mode === "live") return mode;
  throw new Error("ALPACA_TRADING_MODE must be paper or live.");
}

function numberEnv(raw: string | undefined, name: string): number {
  if (raw === undefined || raw.trim().length === 0) {
    throw new Error(`${name} is required for live ops snapshots.`);
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }

  return value;
}

function booleanEnv(raw: string, name: string): boolean {
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes"].includes(value)) return true;
  if (["false", "0", "no"].includes(value)) return false;
  throw new Error(`${name} must be true or false.`);
}
