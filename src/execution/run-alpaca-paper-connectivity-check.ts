import { loadAlpacaIexMarketDataConfig, parseSymbolList } from "../feeds/alpaca-iex-config.js";
import { AlpacaIexMarketDataClient } from "../feeds/alpaca-iex-market-data-client.js";
import { AlpacaOrderExecutor } from "./alpaca-order-executor.js";
import { loadAlpacaTradingConfig } from "./alpaca-trading-config.js";
import { runAlpacaPaperConnectivityCheck } from "./alpaca-paper-connectivity-check.js";

const cli = parseArgs(process.argv.slice(2));
const tradingConfig = loadAlpacaTradingConfig();
const marketDataConfig = loadAlpacaIexMarketDataConfig();
const symbols = cli.symbols ?? marketDataConfig.symbols;
const result = await runAlpacaPaperConnectivityCheck({
  broker: new AlpacaOrderExecutor(tradingConfig),
  marketData: new AlpacaIexMarketDataClient(marketDataConfig),
  symbols,
  maxCandleAgeMs: cli.maxCandleAgeMs
});

console.log(JSON.stringify(result, null, 2));

interface ConnectivityCli {
  symbols?: string[];
  maxCandleAgeMs: number;
}

function parseArgs(args: string[]): ConnectivityCli {
  const symbols = readOption(args, "--symbols");

  return {
    ...(symbols ? { symbols: parseSymbolList(symbols) } : {}),
    maxCandleAgeMs: nonNegativeNumberOption(args, "--max-candle-age-ms", 15 * 60_000)
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.findIndex((arg) => arg === name);
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value) {
    throw new Error(`${name} requires a value.`);
  }

  return value;
}

function nonNegativeNumberOption(args: string[], name: string, fallback: number): number {
  const raw = readOption(args, name);
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }

  return value;
}
