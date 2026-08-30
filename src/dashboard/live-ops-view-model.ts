import type { TradingMode } from "../core/types.js";
import type { AccountSnapshot } from "../portfolio/interfaces.js";

export type LiveOpsReadinessStatus = "ready" | "warning" | "blocked";

export interface LiveOpsDashboardViewModel {
  mode: TradingMode;
  executable: boolean;
  headlineStatus: LiveOpsReadinessStatus;
  updatedAt: string;
  account: LiveOpsAccountSummary;
  breakEven: LiveOpsBreakEvenSummary;
  tradingControls: LiveOpsTradingControl[];
  riskLimits: LiveOpsRiskLimit[];
  positions: LiveOpsPositionRow[];
  orders: LiveOpsOrderRow[];
  paperCycles?: LiveOpsPaperCycleRow[];
  readinessChecks: LiveOpsReadinessCheck[];
  paperRun?: LiveOpsPaperRunSummary;
  breakEvenAudit?: LiveOpsBreakEvenAuditSummary;
}

export interface LiveOpsAccountSummary {
  equity: number;
  cash: number;
  buyingPower: number;
  grossExposure: number;
  dayRealizedPnl: number;
  dayUnrealizedPnl: number;
  currency: string;
}

export interface LiveOpsBreakEvenSummary {
  startingEquity: number;
  currentEquity: number;
  targetEquity: number;
  feesPaidToday: number;
  remainingToBreakEven: number;
  progressPct: number;
}

export interface LiveOpsTradingControl {
  id: string;
  label: string;
  value: string;
  status: LiveOpsReadinessStatus;
}

export interface LiveOpsRiskLimit {
  label: string;
  used: number;
  limit: number;
  unit: "currency" | "percent";
  status: LiveOpsReadinessStatus;
}

export interface LiveOpsPositionRow {
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  markPrice: number;
  unrealizedPnl: number;
  exposure: number;
}

export interface LiveOpsOrderRow {
  id: string;
  timestamp: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limitPrice?: number;
  status: string;
  reason: string;
}

export interface LiveOpsPaperCycleRow {
  id: string;
  timestamp: string;
  strategyId: string;
  symbol: string;
  action: string;
  confidence: number;
  reason: string;
  status: "submitted" | "approved" | "rejected" | "skipped" | "held";
  skippedReason?: string;
  riskApproved?: boolean;
  orderStatus?: string;
}

export interface LiveOpsReadinessCheck {
  id: string;
  label: string;
  detail: string;
  status: LiveOpsReadinessStatus;
}

export interface LiveOpsPaperRunSummary {
  dryRun: boolean;
  submittedNotional: number;
  maxNotionalPerRun: number | null;
  executionCount: number;
  maxExecutionsPerRun: number | null;
  skippedCount: number;
}

export interface LiveOpsBreakEvenAuditSummary {
  dayCount: number;
  metCount: number;
  missedCount: number;
  currentStreak: number;
  longestStreak: number;
  allDaysMet: boolean;
}

export interface LiveOpsFromAccountInput extends Omit<
  BuildLiveOpsDashboardInput,
  "account" | "startingEquity" | "feesPaidToday" | "updatedAt"
> {
  accountSnapshot: AccountSnapshot;
  dayStartingEquity: number;
  dayFeesPaid: number;
  updatedAt?: string | Date;
}

export interface BuildLiveOpsDashboardInput {
  mode: TradingMode;
  executable?: boolean;
  updatedAt: string | Date;
  account: LiveOpsAccountSummary;
  startingEquity: number;
  feesPaidToday: number;
  tradingControls: LiveOpsTradingControl[];
  riskLimits: LiveOpsRiskLimit[];
  positions: LiveOpsPositionRow[];
  orders: LiveOpsOrderRow[];
  paperCycles?: LiveOpsPaperCycleRow[];
  readinessChecks: LiveOpsReadinessCheck[];
  paperRun?: LiveOpsPaperRunSummary;
  breakEvenAudit?: LiveOpsBreakEvenAuditSummary;
}

export function buildLiveOpsDashboardViewModel(
  input: BuildLiveOpsDashboardInput
): LiveOpsDashboardViewModel {
  const currentEquity = input.account.equity;
  const remainingToBreakEven = Math.max(
    0,
    input.startingEquity + input.feesPaidToday - currentEquity
  );
  const targetEquity = input.startingEquity + input.feesPaidToday;
  const progressPct =
    targetEquity <= input.startingEquity
      ? currentEquity >= targetEquity
        ? 100
        : 0
      : clamp(
          ((currentEquity - input.startingEquity) / (targetEquity - input.startingEquity)) * 100
        );

  return {
    mode: input.mode,
    executable: input.executable ?? input.mode === "paper",
    headlineStatus: mostSevere([
      ...input.tradingControls.map((control) => control.status),
      ...input.riskLimits.map((limit) => limit.status),
      ...input.readinessChecks.map((check) => check.status)
    ]),
    updatedAt: isoString(input.updatedAt),
    account: input.account,
    breakEven: {
      startingEquity: input.startingEquity,
      currentEquity,
      targetEquity,
      feesPaidToday: input.feesPaidToday,
      remainingToBreakEven,
      progressPct
    },
    tradingControls: input.tradingControls,
    riskLimits: input.riskLimits,
    positions: input.positions,
    orders: input.orders,
    ...(input.paperCycles ? { paperCycles: input.paperCycles } : {}),
    readinessChecks: input.readinessChecks,
    ...(input.paperRun ? { paperRun: input.paperRun } : {}),
    ...(input.breakEvenAudit ? { breakEvenAudit: input.breakEvenAudit } : {})
  };
}

export function buildLiveOpsDashboardFromAccountSnapshot(
  input: LiveOpsFromAccountInput
): LiveOpsDashboardViewModel {
  return buildLiveOpsDashboardViewModel({
    ...input,
    updatedAt: input.updatedAt ?? input.accountSnapshot.timestamp,
    startingEquity: input.dayStartingEquity,
    feesPaidToday: input.dayFeesPaid,
    account: {
      equity: input.accountSnapshot.equity,
      cash: input.accountSnapshot.cash,
      buyingPower: input.accountSnapshot.buyingPower,
      grossExposure: input.accountSnapshot.grossExposure,
      dayRealizedPnl: input.accountSnapshot.realizedPnl,
      dayUnrealizedPnl: input.accountSnapshot.unrealizedPnl,
      currency: input.accountSnapshot.currency
    }
  });
}

function isoString(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Live ops updatedAt must be a valid date.");
  }

  return date.toISOString();
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function mostSevere(statuses: LiveOpsReadinessStatus[]): LiveOpsReadinessStatus {
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("warning")) return "warning";
  return "ready";
}
