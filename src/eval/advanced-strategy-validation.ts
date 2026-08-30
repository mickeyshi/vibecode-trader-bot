import type { Candle } from "../core/types.js";
import { AllocationIntentMapper } from "../strategies/allocation-intent-mapper.js";
import { createDefaultStrategyRegistry } from "../strategies/registry.js";
import { SimpleBacktester } from "./simple-backtester.js";
import type { BacktestReport } from "./interfaces.js";

export const ADVANCED_STRATEGY_IDS = [
  "volatility-breakout",
  "trend-filtered-momentum",
  "scored-context"
] as const;

export interface StrategyValidationResult {
  generatedAt: Date;
  scenarios: ValidationScenario[];
  runs: ValidationRun[];
}

export interface ValidationScenario {
  id: string;
  description: string;
  candles: Candle[];
}

export interface ValidationRun {
  scenarioId: string;
  friction: "base" | "stressed";
  strategyId: string;
  report: BacktestReport;
}

export async function runAdvancedStrategyValidation(): Promise<StrategyValidationResult> {
  const scenarios = makeValidationScenarios();
  const registry = createDefaultStrategyRegistry();
  const runs: ValidationRun[] = [];

  for (const scenario of scenarios) {
    for (const friction of ["base", "stressed"] as const) {
      for (const strategyId of ["buy-and-hold", ...ADVANCED_STRATEGY_IDS]) {
        const strategy = registry.create(strategyId);
        const mapper = new AllocationIntentMapper({
          accountEquity: 10_000,
          targetAllocationPct: 0.1
        });
        const report = await new SimpleBacktester({ strategy, mapper }).run({
          strategyId,
          symbols: ["VALIDATION"],
          candles: scenario.candles,
          startingEquity: 10_000,
          feeRate: friction === "base" ? 0.001 : 0.0025,
          slippageBps: friction === "base" ? 5 : 20,
          spreadBps: friction === "base" ? 5 : 20,
          fillRatio: 1,
          maxDataGapDays: 4,
          marketCalendar: "weekday"
        });
        runs.push({ scenarioId: scenario.id, friction, strategyId, report });
      }
    }
  }

  return { generatedAt: new Date(), scenarios, runs };
}

export function renderAdvancedStrategyValidation(result: StrategyValidationResult): string {
  const baseRuns = result.runs.filter((run) => run.friction === "base");
  const lines = [
    "# Advanced Strategy Validation Report",
    "",
    `Generated: ${result.generatedAt.toISOString()}`,
    "",
    "> Research status: framework validation on deterministic synthetic fixtures. These results do not establish profitability or suitability for live capital.",
    "",
    "## Method",
    "",
    "Each strategy used its registered default parameters, with no tuning on these scenarios. Every run used the shared signal -> intent -> risk -> paper executor -> portfolio replay path and the same 10% target allocation, preventing repeated buy signals from creating unequal benchmark exposure. Buy-and-hold is the benchmark. Base friction is 0.10% fee, 5 bps slippage, and 5 bps spread; stressed friction is 0.25% fee, 20 bps slippage, and 20 bps spread. Orders fill immediately and completely at the modeled candle close. The calendar is weekday-only with no holidays, dividends, taxes, latency, liquidity, corporate actions, or short selling.",
    "",
    "The fixtures contain 90 daily candles from 2024-01-02 onward and intentionally represent distinct regimes. They are deterministic test inputs, not sampled market history, so the report vets mechanics and directional behavior rather than forecasting skill.",
    "",
    "## Base-friction results",
    "",
    "| Scenario | Strategy | Return | Effect vs benchmark | Max drawdown | Closed trades | Filled orders |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: |"
  ];

  for (const scenario of result.scenarios) {
    const scenarioRuns = baseRuns.filter((run) => run.scenarioId === scenario.id);
    const benchmark = scenarioRuns.find((run) => run.strategyId === "buy-and-hold")!;
    for (const run of scenarioRuns) {
      lines.push(
        `| ${scenario.id} | ${run.strategyId} | ${pct(run.report.totalReturnPct)} | ${signedPct(run.report.totalReturnPct - benchmark.report.totalReturnPct)} | ${pct(run.report.maxDrawdownPct)} | ${run.report.metrics.closedTradeCount} | ${run.report.metrics.filledOrderCount} |`
      );
    }
  }

  lines.push("", "## Friction sensitivity", "");
  lines.push(
    "| Strategy | Base average return | Stressed average return | Change | Positive base scenarios |",
    "| --- | ---: | ---: | ---: | ---: |"
  );
  for (const strategyId of ADVANCED_STRATEGY_IDS) {
    const base = averageReturn(result.runs, strategyId, "base");
    const stressed = averageReturn(result.runs, strategyId, "stressed");
    const positive = baseRuns.filter(
      (run) => run.strategyId === strategyId && run.report.totalReturnPct > 0
    ).length;
    lines.push(
      `| ${strategyId} | ${pct(base)} | ${pct(stressed)} | ${signedPct(stressed - base)} | ${positive}/${result.scenarios.length} |`
    );
  }

  lines.push("", "## Vetted effects", "");
  for (const strategyId of ADVANCED_STRATEGY_IDS) {
    const effects = result.scenarios.map((scenario) => {
      const run = baseRuns.find(
        (candidate) => candidate.scenarioId === scenario.id && candidate.strategyId === strategyId
      )!;
      const benchmark = baseRuns.find(
        (candidate) =>
          candidate.scenarioId === scenario.id && candidate.strategyId === "buy-and-hold"
      )!;
      return `${scenario.id} ${signedPct(run.report.totalReturnPct - benchmark.report.totalReturnPct)}`;
    });
    lines.push(`- **${strategyId}:** benchmark-relative return by regime: ${effects.join(", ")}.`);
  }

  lines.push(
    "",
    "The comparison shows conditional effects, not a universal ranking. A strategy is mechanically useful only if its signals, risk path, and regime response match its design; promotion requires real point-in-time data, walk-forward or rolling out-of-sample tests, parameter-stability analysis, and realistic liquidity/execution modeling.",
    "",
    "## Scenario definitions",
    ""
  );
  for (const scenario of result.scenarios) {
    lines.push(`- **${scenario.id}:** ${scenario.description}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function makeValidationScenarios(): ValidationScenario[] {
  return [
    {
      id: "persistent-trend",
      description:
        "A quiet initial range followed by a sustained advance and a mild late pullback.",
      candles: candlesFromCloses([
        ...wave(30, 100, 0.15, 0.45),
        ...wave(45, 104, 0.75, 0.35),
        ...wave(15, 137, -0.3, 0.5)
      ])
    },
    {
      id: "breakout-reversal",
      description:
        "A long range, an abrupt upside breakout, continuation, then a breakdown reversal.",
      candles: candlesFromCloses([
        ...wave(35, 100, 0, 1.2),
        ...wave(10, 103, 2.2, 0.4),
        ...wave(20, 125, 0.45, 0.6),
        ...wave(25, 134, -1.35, 0.8)
      ])
    },
    {
      id: "volatile-chop",
      description: "Large alternating moves around a flat center with no persistent direction.",
      candles: candlesFromCloses(wave(90, 100, 0, 5.5))
    }
  ];
}

function wave(count: number, start: number, slope: number, amplitude: number): number[] {
  return Array.from({ length: count }, (_, index) =>
    Math.max(1, start + slope * index + Math.sin(index * 1.7) * amplitude)
  );
}

function candlesFromCloses(closes: number[]): Candle[] {
  const start = Date.UTC(2024, 0, 2);
  return closes.map((close, index) => {
    const prior = closes[index - 1] ?? close;
    const closeTime = nextWeekday(start, index);
    return {
      symbol: "VALIDATION",
      timeframe: "1d",
      openTime: closeTime,
      closeTime,
      open: prior,
      high: Math.max(prior, close) * 1.005,
      low: Math.min(prior, close) * 0.995,
      close,
      volume: 1_000_000
    };
  });
}

function nextWeekday(start: number, weekdayOffset: number): Date {
  const date = new Date(start);
  let remaining = weekdayOffset;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6) remaining -= 1;
  }
  return date;
}

function averageReturn(
  runs: ValidationRun[],
  strategyId: string,
  friction: ValidationRun["friction"]
): number {
  const matches = runs.filter((run) => run.strategyId === strategyId && run.friction === friction);
  return matches.reduce((sum, run) => sum + run.report.totalReturnPct, 0) / matches.length;
}

function pct(value: number): string {
  return `${value.toFixed(2)}%`;
}

function signedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)} pp`;
}
