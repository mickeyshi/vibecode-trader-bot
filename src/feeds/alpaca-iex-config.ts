export interface AlpacaIexMarketDataConfig {
  apiKeyId: string;
  apiSecretKey: string;
  baseUrl: string;
  feed: "iex";
  symbols: string[];
}

export interface AlpacaIexConfigEnv {
  ALPACA_DATA_API_KEY_ID?: string;
  ALPACA_DATA_API_SECRET_KEY?: string;
  ALPACA_DATA_BASE_URL?: string;
  ALPACA_SYMBOLS?: string;
}

const defaultBaseUrl = "https://data.alpaca.markets";

export function loadAlpacaIexMarketDataConfig(
  env: AlpacaIexConfigEnv = process.env
): AlpacaIexMarketDataConfig {
  const apiKeyId = requiredEnv(env.ALPACA_DATA_API_KEY_ID, "ALPACA_DATA_API_KEY_ID");
  const apiSecretKey = requiredEnv(env.ALPACA_DATA_API_SECRET_KEY, "ALPACA_DATA_API_SECRET_KEY");
  const symbols = parseSymbolList(env.ALPACA_SYMBOLS ?? "SPY");

  return {
    apiKeyId,
    apiSecretKey,
    baseUrl: env.ALPACA_DATA_BASE_URL ?? defaultBaseUrl,
    feed: "iex",
    symbols
  };
}

export function parseSymbolList(raw: string): string[] {
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    throw new Error("At least one Alpaca symbol is required.");
  }

  return symbols;
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for Alpaca IEX market data ingest.`);
  }

  return value;
}
