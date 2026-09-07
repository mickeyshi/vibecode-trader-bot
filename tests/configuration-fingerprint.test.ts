import { describe, expect, it } from "vitest";
import { buildConfigurationEvidence } from "../src/execution/configuration-fingerprint.js";

describe("configuration evidence", () => {
  it("is stable across object key order and exposes only supplied safe values", () => {
    const left = buildConfigurationEvidence({ mode: "paper", limits: { order: 25, run: 50 } });
    const right = buildConfigurationEvidence({ limits: { run: 50, order: 25 }, mode: "paper" });
    expect(left.fingerprint).toBe(right.fingerprint);
    expect(left.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(left.effective).toEqual({ limits: { order: 25, run: 50 }, mode: "paper" });
  });
});
