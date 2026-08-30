import { describe, expect, it } from "vitest";
import {
  ADVANCED_STRATEGY_IDS,
  makeValidationScenarios,
  renderAdvancedStrategyValidation,
  runAdvancedStrategyValidation
} from "../src/eval/advanced-strategy-validation.js";

describe("advanced strategy validation", () => {
  it("builds three chronological, weekday-only regime fixtures", () => {
    const scenarios = makeValidationScenarios();
    expect(scenarios).toHaveLength(3);
    for (const scenario of scenarios) {
      expect(scenario.candles).toHaveLength(90);
      expect(
        scenario.candles.every((candle) => ![0, 6].includes(candle.closeTime.getUTCDay()))
      ).toBe(true);
      expect(
        scenario.candles.every(
          (candle, index) =>
            index === 0 || candle.closeTime > scenario.candles[index - 1]!.closeTime
        )
      ).toBe(true);
    }
  });

  it("runs every advanced strategy and benchmark under base and stressed friction", async () => {
    const result = await runAdvancedStrategyValidation();
    expect(result.runs).toHaveLength(3 * 4 * 2);
    for (const strategyId of ADVANCED_STRATEGY_IDS) {
      expect(result.runs.filter((run) => run.strategyId === strategyId)).toHaveLength(6);
    }
    expect(result.runs.every((run) => run.report.dataQualityWarnings.length === 0)).toBe(true);
  });

  it("renders assumptions, comparisons, sensitivity, and limitations", async () => {
    const markdown = renderAdvancedStrategyValidation(await runAdvancedStrategyValidation());
    expect(markdown).toContain("# Advanced Strategy Validation Report");
    expect(markdown).toContain("Effect vs benchmark");
    expect(markdown).toContain("## Friction sensitivity");
    expect(markdown).toContain("framework validation on deterministic synthetic fixtures");
    expect(markdown).toContain("walk-forward or rolling out-of-sample tests");
  });
});
