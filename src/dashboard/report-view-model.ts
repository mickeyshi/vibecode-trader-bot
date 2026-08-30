import type { BacktestComparisonRanking } from "../eval/backtest-cli.js";
import type { StrategyMetadata } from "../strategies/registry.js";

export type DashboardReportKind = "single" | "comparison";

export interface DashboardReportViewModel {
  sourcePath?: string;
  kind: DashboardReportKind;
  reportCount: number;
  rankings: BacktestComparisonRanking[];
  strategyMetadata: StrategyMetadata[];
  runs: DashboardRunSummary[];
  equitySeries: DashboardEquitySeries[];
  alerts: DashboardAlertRow[];
  decisionTraces: DashboardDecisionTraceRow[];
}

export interface DashboardRunSummary {
  strategyId: string;
  start: string;
  end: string;
  endingEquity: number;
  totalReturnPct: number;
  maxDrawdownPct: number;
  netProfit: number;
  totalFees: number;
  orderCount: number;
  fillCount: number;
  riskRejectionCount: number;
  closedTradeCount: number;
  alertCount: number;
  dataQualityWarningCount: number;
}

export interface DashboardEquitySeries {
  strategyId: string;
  points: DashboardEquityPoint[];
}

export interface DashboardEquityPoint {
  timestamp: string;
  equity: number;
}

export interface DashboardAlertRow {
  id: string;
  timestamp: string;
  severity: string;
  type: string;
  message: string;
  strategyId?: string;
  symbol?: string;
}

export interface DashboardDecisionTraceRow {
  id: string;
  timestamp: string;
  strategyId: string;
  symbol: string;
  action: string;
  confidence: number;
  reason: string;
  hasIntent: boolean;
  riskApproved?: boolean;
  orderStatus?: string;
  fillCount: number;
  equity: number;
}

export function buildDashboardReportViewModel(
  rawReport: unknown,
  sourcePath?: string
): DashboardReportViewModel {
  const root = objectValue(rawReport, "dashboard report");
  const reports = Array.isArray(root.reports) ? root.reports : [root];
  if (reports.length === 0) {
    throw new Error("Dashboard report must include at least one backtest report.");
  }

  const reportObjects = reports.map((report, index) =>
    objectValue(report, `dashboard report reports[${index}]`)
  );
  const kind: DashboardReportKind = Array.isArray(root.reports) ? "comparison" : "single";

  return {
    ...(sourcePath !== undefined ? { sourcePath } : {}),
    kind,
    reportCount: reportObjects.length,
    rankings: rankingRows(root.rankings),
    strategyMetadata: strategyMetadataRows(root.strategyMetadata),
    runs: reportObjects.map(toRunSummary),
    equitySeries: reportObjects.map(toEquitySeries),
    alerts: reportObjects.flatMap(toAlertRows),
    decisionTraces: reportObjects.flatMap(toDecisionTraceRows)
  };
}

function toRunSummary(report: Record<string, unknown>): DashboardRunSummary {
  const strategyId = stringValue(report.strategyId, "report.strategyId");
  const metrics = objectValue(report.metrics, `${strategyId}.metrics`);

  return {
    strategyId,
    start: isoStringValue(report.start, `${strategyId}.start`),
    end: isoStringValue(report.end, `${strategyId}.end`),
    endingEquity: numberValue(report.endingEquity, `${strategyId}.endingEquity`),
    totalReturnPct: numberValue(report.totalReturnPct, `${strategyId}.totalReturnPct`),
    maxDrawdownPct: numberValue(report.maxDrawdownPct, `${strategyId}.maxDrawdownPct`),
    netProfit: numberValue(metrics.netProfit, `${strategyId}.metrics.netProfit`),
    totalFees: numberValue(metrics.totalFees, `${strategyId}.metrics.totalFees`),
    orderCount: arrayValue(report.orders, `${strategyId}.orders`).length,
    fillCount: arrayValue(report.fills, `${strategyId}.fills`).length,
    riskRejectionCount: arrayValue(report.riskRejections, `${strategyId}.riskRejections`).length,
    closedTradeCount: numberValue(
      metrics.closedTradeCount,
      `${strategyId}.metrics.closedTradeCount`
    ),
    alertCount: arrayValue(report.alerts, `${strategyId}.alerts`).length,
    dataQualityWarningCount: arrayValue(
      report.dataQualityWarnings,
      `${strategyId}.dataQualityWarnings`
    ).length
  };
}

function toEquitySeries(report: Record<string, unknown>): DashboardEquitySeries {
  const strategyId = stringValue(report.strategyId, "report.strategyId");
  const points = arrayValue(report.equityCurve, `${strategyId}.equityCurve`).map((point, index) => {
    const row = objectValue(point, `${strategyId}.equityCurve[${index}]`);
    return {
      timestamp: isoStringValue(row.timestamp, `${strategyId}.equityCurve[${index}].timestamp`),
      equity: numberValue(row.equity, `${strategyId}.equityCurve[${index}].equity`)
    };
  });

  return { strategyId, points };
}

function toAlertRows(report: Record<string, unknown>): DashboardAlertRow[] {
  const strategyId = stringValue(report.strategyId, "report.strategyId");
  return arrayValue(report.alerts, `${strategyId}.alerts`).map((alert, index) => {
    const row = objectValue(alert, `${strategyId}.alerts[${index}]`);
    const context = optionalObjectValue(row.context);
    const symbol = optionalString(context.symbol);
    const alertRow: DashboardAlertRow = {
      id: stringValue(row.id, `${strategyId}.alerts[${index}].id`),
      timestamp: isoStringValue(row.timestamp, `${strategyId}.alerts[${index}].timestamp`),
      severity: stringValue(row.severity, `${strategyId}.alerts[${index}].severity`),
      type: stringValue(row.type, `${strategyId}.alerts[${index}].type`),
      message: stringValue(row.message, `${strategyId}.alerts[${index}].message`),
      strategyId: optionalString(context.strategyId) ?? strategyId
    };

    if (symbol) {
      alertRow.symbol = symbol;
    }

    return alertRow;
  });
}

function toDecisionTraceRows(report: Record<string, unknown>): DashboardDecisionTraceRow[] {
  const strategyId = stringValue(report.strategyId, "report.strategyId");
  return arrayValue(report.decisionTraces, `${strategyId}.decisionTraces`).map((trace, index) => {
    const row = objectValue(trace, `${strategyId}.decisionTraces[${index}]`);
    const signal = objectValue(row.signal, `${strategyId}.decisionTraces[${index}].signal`);
    const riskDecision = optionalObjectValue(row.riskDecision);
    const order = optionalObjectValue(row.order);
    const traceRow: DashboardDecisionTraceRow = {
      id: stringValue(row.id, `${strategyId}.decisionTraces[${index}].id`),
      timestamp: isoStringValue(row.timestamp, `${strategyId}.decisionTraces[${index}].timestamp`),
      strategyId: stringValue(row.strategyId, `${strategyId}.decisionTraces[${index}].strategyId`),
      symbol: stringValue(row.symbol, `${strategyId}.decisionTraces[${index}].symbol`),
      action: stringValue(signal.action, `${strategyId}.decisionTraces[${index}].signal.action`),
      confidence: numberValue(
        signal.confidence,
        `${strategyId}.decisionTraces[${index}].signal.confidence`
      ),
      reason: stringValue(signal.reason, `${strategyId}.decisionTraces[${index}].signal.reason`),
      hasIntent: row.intent !== undefined,
      fillCount: numberValue(row.fillCount, `${strategyId}.decisionTraces[${index}].fillCount`),
      equity: numberValue(row.equity, `${strategyId}.decisionTraces[${index}].equity`)
    };

    if (typeof riskDecision.approved === "boolean") {
      traceRow.riskApproved = riskDecision.approved;
    }

    const orderStatus = optionalString(order.status);
    if (orderStatus) {
      traceRow.orderStatus = orderStatus;
    }

    return traceRow;
  });
}

function rankingRows(value: unknown): BacktestComparisonRanking[] {
  if (value === undefined) return [];
  return arrayValue(value, "rankings").map((ranking, index) => {
    const row = objectValue(ranking, `rankings[${index}]`);
    return {
      rank: numberValue(row.rank, `rankings[${index}].rank`),
      strategyId: stringValue(row.strategyId, `rankings[${index}].strategyId`),
      score: numberValue(row.score, `rankings[${index}].score`),
      totalReturnPct: numberValue(row.totalReturnPct, `rankings[${index}].totalReturnPct`),
      maxDrawdownPct: numberValue(row.maxDrawdownPct, `rankings[${index}].maxDrawdownPct`),
      profitFactor:
        row.profitFactor === null
          ? null
          : numberValue(row.profitFactor, `rankings[${index}].profitFactor`),
      closedTradeCount: numberValue(row.closedTradeCount, `rankings[${index}].closedTradeCount`),
      dataQualityWarningCount: numberValue(
        row.dataQualityWarningCount,
        `rankings[${index}].dataQualityWarningCount`
      ),
      reason: stringValue(row.reason, `rankings[${index}].reason`)
    };
  });
}

function strategyMetadataRows(value: unknown): StrategyMetadata[] {
  if (value === undefined) return [];
  return arrayValue(value, "strategyMetadata").map((metadata, index) => {
    const row = objectValue(metadata, `strategyMetadata[${index}]`);
    return {
      id: stringValue(row.id, `strategyMetadata[${index}].id`),
      name: stringValue(row.name, `strategyMetadata[${index}].name`),
      description: stringValue(row.description, `strategyMetadata[${index}].description`),
      category: stringValue(
        row.category,
        `strategyMetadata[${index}].category`
      ) as StrategyMetadata["category"],
      defaultParams: objectValue(row.defaultParams, `strategyMetadata[${index}].defaultParams`),
      tags: arrayValue(row.tags, `strategyMetadata[${index}].tags`).map((tag, tagIndex) =>
        stringValue(tag, `strategyMetadata[${index}].tags[${tagIndex}]`)
      )
    };
  });
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function optionalObjectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function isoStringValue(value: unknown, label: string): string {
  const raw = value instanceof Date ? value.toISOString() : stringValue(value, label);
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid date string.`);
  }

  return date.toISOString();
}
