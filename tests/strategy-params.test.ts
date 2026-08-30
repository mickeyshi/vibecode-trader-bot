import { describe, expect, it } from "vitest";
import { createDefaultStrategyRegistry } from "../src/strategies/registry.js";
import { parseStrategyParam, parseStrategyParams } from "../src/strategies/strategy-params.js";

describe("strategy params", () => {
  it("parses repeatable key-value strategy params", () => {
    expect(parseStrategyParams(["shortWindow=2", "longWindow=4", "minConfidence=0.02"])).toEqual({
      shortWindow: 2,
      longWindow: 4,
      minConfidence: 0.02
    });
  });

  it("parses booleans and preserves non-numeric strings", () => {
    expect(parseStrategyParams(["enabled=true", "label=paper-test"])).toEqual({
      enabled: true,
      label: "paper-test"
    });
  });

  it("feeds parsed params into registered strategy creation", () => {
    const params = parseStrategyParams(["shortWindow=1", "longWindow=3", "minConfidence=0.01"]);

    expect(() =>
      createDefaultStrategyRegistry().create("moving-average-crossover", params)
    ).not.toThrow();
  });

  it("rejects malformed strategy params", () => {
    expect(() => parseStrategyParam("shortWindow")).toThrow("key=value");
  });
});
