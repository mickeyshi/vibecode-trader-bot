import { loadResearchCandles } from "../eval/research-candle-loader.js";
import { EtfRelativeMomentumAllocator } from "./etf-relative-momentum-allocator.js";

const path = process.argv[2] ?? "test-fixtures/data/alpaca-etf-daily.json";
const candles = await loadResearchCandles(path);
const histories = new Map<string, number[]>();
for (const candle of candles) {
  const values = histories.get(candle.symbol) ?? [];
  values.push(candle.close);
  histories.set(candle.symbol, values);
}
const plan = new EtfRelativeMomentumAllocator().allocate({ closeHistoryBySymbol: histories });
const asOf = candles.reduce(
  (latest, candle) => (candle.openTime > latest ? candle.openTime : latest),
  new Date(0)
);
console.log(
  JSON.stringify({ dryRun: true, brokerAccess: false, orderSubmission: false, asOf, plan }, null, 2)
);
