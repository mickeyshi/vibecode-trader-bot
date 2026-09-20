import { readFile } from "node:fs/promises";
import type { Candle } from "../core/types.js";

export interface ResearchDataset {
  source: string;
  adjustment: "all";
  corporateActionAdjustments: string[];
  timeframe: string;
  requestedAt: string;
  from: string;
  to: string;
  symbols: string[];
  candles: Candle[];
}

export async function loadResearchCandles(path: string): Promise<Candle[]> {
  return (await loadResearchDataset(path)).candles;
}

export async function loadResearchDataset(path: string): Promise<ResearchDataset> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (!Array.isArray(raw.candles)) throw new Error(`${path} does not contain a candles array.`);
  if (raw.source !== "Alpaca IEX historical bars") {
    throw new Error(`${path} has an unsupported research data source.`);
  }
  if (raw.adjustment !== "all") {
    throw new Error(`${path} must use adjustment=all for benchmark research.`);
  }
  const adjustments = stringArray(raw.corporateActionAdjustments);
  for (const required of ["split", "dividend", "spin-off"]) {
    if (!adjustments.includes(required)) {
      throw new Error(`${path} is missing the ${required} adjustment provenance.`);
    }
  }
  return {
    source: raw.source,
    adjustment: raw.adjustment,
    corporateActionAdjustments: adjustments,
    timeframe: requiredString(raw.timeframe, "timeframe"),
    requestedAt: requiredString(raw.requestedAt, "requestedAt"),
    from: requiredString(raw.from, "from"),
    to: requiredString(raw.to, "to"),
    symbols: stringArray(raw.symbols),
    candles: raw.candles.map((bar) => {
      if (!bar || typeof bar !== "object") throw new Error(`${path} contains an invalid candle.`);
      const record = bar as Record<string, unknown>;
      return {
        ...(record as unknown as Candle),
        openTime: new Date(String(record.openTime)),
        closeTime: new Date(String(record.closeTime))
      };
    })
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value)
    throw new Error(`Research dataset ${field} is required.`);
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error("Research dataset string-array metadata is invalid.");
  }
  return value;
}
