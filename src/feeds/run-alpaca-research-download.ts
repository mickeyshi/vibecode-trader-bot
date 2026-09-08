import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AlpacaIexMarketDataClient } from "./alpaca-iex-market-data-client.js";
import { loadAlpacaIexMarketDataConfig, parseSymbolList } from "./alpaca-iex-config.js";

const args = parseArgs(process.argv.slice(2));
const config = loadAlpacaIexMarketDataConfig();
const client = new AlpacaIexMarketDataClient(config);
const candles = await client.getHistoricalBars(args.symbols, {
  limit: 10_000,
  start: new Date(`${args.from}T00:00:00.000Z`),
  end: new Date(`${args.to}T23:59:59.999Z`),
  timeframe: "1Day",
  adjustment: "all"
});

await mkdir(dirname(args.out), { recursive: true });
await writeFile(
  args.out,
  `${JSON.stringify(
    {
      source: "Alpaca IEX historical bars",
      adjustment: "all",
      timeframe: "1d",
      requestedAt: new Date().toISOString(),
      from: args.from,
      to: args.to,
      symbols: args.symbols,
      candles
    },
    null,
    2
  )}\n`,
  "utf8"
);
console.log(
  JSON.stringify({ out: args.out, symbols: args.symbols, candleCount: candles.length }, null, 2)
);

function parseArgs(values: string[]): { symbols: string[]; from: string; to: string; out: string } {
  const result = {
    symbols: ["SPY", "QQQ", "IWM", "IEF", "GLD"],
    from: "2010-01-01",
    to: new Date().toISOString().slice(0, 10),
    out: "test-fixtures/data/alpaca-etf-daily.json"
  };
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    const value = values[index + 1];
    if (!value) throw new Error(`${name} requires a value.`);
    if (name === "--symbols") result.symbols = parseSymbolList(value);
    else if (name === "--from") result.from = dateValue(value, name);
    else if (name === "--to") result.to = dateValue(value, name);
    else if (name === "--out") result.out = value;
    else throw new Error(`Unknown option: ${name}`);
    index += 1;
  }
  if (result.from >= result.to) throw new Error("--from must be before --to.");
  return result;
}

function dateValue(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid YYYY-MM-DD date.`);
  }
  return value;
}
