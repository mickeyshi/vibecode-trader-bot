export interface EtfResearchViewModel {
  dataProvenance: { source: string; adjustment: string; requestedAt: string };
  benchmarkDefinition: { symbol: string; grossWeight: number; interpretation: string };
  results: EtfResearchScenario[];
}

export interface EtfResearchScenario {
  configuration: {
    momentumWindow: number;
    trendWindow: number;
    transactionCostBps: number;
    rebalanceDelaySessions: number;
    skipEveryNthRebalance: number;
    cashAnnualYieldPct: number;
  };
  result: {
    firstDate: string;
    lastDate: string;
    strategy: ResearchPerformance;
    benchmark: ResearchPerformance;
  };
}

export interface ResearchPerformance {
  totalReturnPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  turnover: number;
  annualReturnsPct: Record<string, number>;
  symbolContributionPct: Record<string, number>;
  regimeContributionPct: Record<string, number>;
}

export function buildEtfResearchViewModel(raw: unknown): EtfResearchViewModel {
  const root = objectValue(raw, "ETF research report");
  if (root.researchOnly !== true) throw new Error("ETF research report must be research-only.");
  const provenance = objectValue(root.dataProvenance, "dataProvenance");
  const benchmark = objectValue(root.benchmarkDefinition, "benchmarkDefinition");
  const results = arrayValue(root.results, "results").map((value, index) =>
    scenarioValue(value, index)
  );
  if (results.length === 0) throw new Error("ETF research report must include scenarios.");
  return {
    dataProvenance: {
      source: stringValue(provenance.source, "dataProvenance.source"),
      adjustment: stringValue(provenance.adjustment, "dataProvenance.adjustment"),
      requestedAt: dateValue(provenance.requestedAt, "dataProvenance.requestedAt")
    },
    benchmarkDefinition: {
      symbol: stringValue(benchmark.symbol, "benchmarkDefinition.symbol"),
      grossWeight: numberValue(benchmark.grossWeight, "benchmarkDefinition.grossWeight"),
      interpretation: stringValue(benchmark.interpretation, "benchmarkDefinition.interpretation")
    },
    results
  };
}

function scenarioValue(value: unknown, index: number): EtfResearchScenario {
  const row = objectValue(value, `results[${index}]`);
  const configuration = objectValue(row.configuration, `results[${index}].configuration`);
  const result = objectValue(row.result, `results[${index}].result`);
  return {
    configuration: {
      momentumWindow: numberValue(configuration.momentumWindow, "momentumWindow"),
      trendWindow: numberValue(configuration.trendWindow, "trendWindow"),
      transactionCostBps: numberValue(configuration.transactionCostBps, "transactionCostBps"),
      rebalanceDelaySessions: numberValue(
        configuration.rebalanceDelaySessions,
        "rebalanceDelaySessions"
      ),
      skipEveryNthRebalance: numberValue(
        configuration.skipEveryNthRebalance,
        "skipEveryNthRebalance"
      ),
      cashAnnualYieldPct: numberValue(configuration.cashAnnualYieldPct, "cashAnnualYieldPct")
    },
    result: {
      firstDate: dateValue(result.firstDate, "firstDate", true),
      lastDate: dateValue(result.lastDate, "lastDate", true),
      strategy: performanceValue(result.strategy, "strategy"),
      benchmark: performanceValue(result.benchmark, "benchmark")
    }
  };
}

function performanceValue(value: unknown, label: string): ResearchPerformance {
  const row = objectValue(value, label);
  return {
    totalReturnPct: numberValue(row.totalReturnPct, `${label}.totalReturnPct`),
    sharpeRatio: numberValue(row.sharpeRatio, `${label}.sharpeRatio`),
    maxDrawdownPct: numberValue(row.maxDrawdownPct, `${label}.maxDrawdownPct`),
    turnover: numberValue(row.turnover, `${label}.turnover`),
    annualReturnsPct: numberRecord(row.annualReturnsPct, `${label}.annualReturnsPct`),
    symbolContributionPct: numberRecord(
      row.symbolContributionPct,
      `${label}.symbolContributionPct`
    ),
    regimeContributionPct: numberRecord(row.regimeContributionPct, `${label}.regimeContributionPct`)
  };
}

function numberRecord(value: unknown, label: string): Record<string, number> {
  const row = objectValue(value, label);
  return Object.fromEntries(
    Object.entries(row).map(([key, item]) => [key, numberValue(item, `${label}.${key}`)])
  );
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function dateValue(value: unknown, label: string, dateOnly = false): string {
  const result = stringValue(value, label);
  const parsed = new Date(dateOnly ? `${result}T00:00:00Z` : result);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid date.`);
  return result;
}
