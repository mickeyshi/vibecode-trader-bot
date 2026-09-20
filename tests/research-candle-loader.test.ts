import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadResearchDataset } from "../src/eval/research-candle-loader.js";

describe("research dataset provenance", () => {
  it("loads an explicitly corporate-action-adjusted Alpaca dataset", async () => {
    const path = await datasetFile({
      source: "Alpaca IEX historical bars",
      adjustment: "all",
      corporateActionAdjustments: ["split", "dividend", "spin-off"]
    });
    const dataset = await loadResearchDataset(path);
    expect(dataset.adjustment).toBe("all");
    expect(dataset.candles[0]?.openTime).toBeInstanceOf(Date);
  });

  it("rejects raw or incomplete benchmark adjustment provenance", async () => {
    const raw = await datasetFile({
      source: "Alpaca IEX historical bars",
      adjustment: "raw",
      corporateActionAdjustments: []
    });
    await expect(loadResearchDataset(raw)).rejects.toThrow("adjustment=all");

    const incomplete = await datasetFile({
      source: "Alpaca IEX historical bars",
      adjustment: "all",
      corporateActionAdjustments: ["split", "dividend"]
    });
    await expect(loadResearchDataset(incomplete)).rejects.toThrow("spin-off adjustment provenance");
  });
});

async function datasetFile(overrides: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "research-dataset-"));
  const path = join(root, "data.json");
  await writeFile(
    path,
    JSON.stringify({
      timeframe: "1d",
      requestedAt: "2026-01-01T00:00:00.000Z",
      from: "2020-01-01",
      to: "2026-01-01",
      symbols: ["SPY"],
      candles: [
        {
          symbol: "SPY",
          timeframe: "1d",
          openTime: "2026-01-01T00:00:00.000Z",
          closeTime: "2026-01-02T00:00:00.000Z",
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 1
        }
      ],
      ...overrides
    })
  );
  return path;
}
