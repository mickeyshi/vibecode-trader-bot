import { describe, expect, it } from "vitest";
import {
  buildAllocationPolicy,
  parseAllocationWeights
} from "../src/strategies/allocation-policy.js";

describe("allocation policy", () => {
  it("builds per-symbol targets from explicit weights and defaults", () => {
    expect(
      buildAllocationPolicy({
        symbols: ["SPY", "AAPL", "MSFT"],
        defaultTargetAllocationPct: 0.001,
        allocationWeights: "SPY=0.0025,AAPL=0.0015",
        maxTotalAllocationPct: 0.01
      })
    ).toEqual({
      targetAllocationPctBySymbol: {
        SPY: 0.0025,
        AAPL: 0.0015,
        MSFT: 0.001
      },
      totalAllocationPct: 0.005
    });
  });

  it("rejects weights for symbols outside the coordinator symbol list", () => {
    expect(() =>
      buildAllocationPolicy({
        symbols: ["SPY"],
        defaultTargetAllocationPct: 0.001,
        allocationWeights: "AAPL=0.001",
        maxTotalAllocationPct: 0.01
      })
    ).toThrow("not in --symbols");
  });

  it("rejects portfolios above the total allocation cap", () => {
    expect(() =>
      buildAllocationPolicy({
        symbols: ["SPY", "AAPL"],
        defaultTargetAllocationPct: 0.01,
        maxTotalAllocationPct: 0.015
      })
    ).toThrow("exceeds max total allocation");
  });

  it("parses allocation weight pairs", () => {
    expect(parseAllocationWeights("spy=0.0025, aapl=0.0015")).toEqual({
      SPY: 0.0025,
      AAPL: 0.0015
    });
  });
});
