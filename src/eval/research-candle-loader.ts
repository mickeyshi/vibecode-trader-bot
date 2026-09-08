import { readFile } from "node:fs/promises";
import type { Candle } from "../core/types.js";

export async function loadResearchCandles(path: string): Promise<Candle[]> {
  const raw = JSON.parse(await readFile(path, "utf8")) as { candles?: Record<string, unknown>[] };
  if (!Array.isArray(raw.candles)) throw new Error(`${path} does not contain a candles array.`);
  return raw.candles.map((bar) => ({
    ...(bar as unknown as Candle),
    openTime: new Date(String(bar.openTime)),
    closeTime: new Date(String(bar.closeTime))
  }));
}
