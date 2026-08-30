import { AlpacaIexMarketDataClient } from "./alpaca-iex-market-data-client.js";
import { loadAlpacaIexMarketDataConfig, parseSymbolList } from "./alpaca-iex-config.js";

const config = loadAlpacaIexMarketDataConfig();
const symbols = process.argv[2] ? parseSymbolList(process.argv[2]) : config.symbols;
const client = new AlpacaIexMarketDataClient(config);
const candles = await client.getLatestBars(symbols);

console.log(
  JSON.stringify(
    {
      provider: "alpaca",
      feed: config.feed,
      symbols,
      candles
    },
    null,
    2
  )
);
