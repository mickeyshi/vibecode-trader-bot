import type { Candle } from "../core/types.js";
import type { AlpacaIexMarketDataConfig } from "./alpaca-iex-config.js";
import { requestWithAlpacaRetry, type AlpacaRetryConfig } from "./alpaca-retry.js";

export type AlpacaFetch = (
  input: string,
  init: {
    method: "GET";
    headers: Record<string, string>;
  }
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

interface AlpacaLatestBarsResponse {
  bars: Record<string, AlpacaLatestBar>;
}

interface AlpacaHistoricalBarsResponse {
  bars: Record<string, AlpacaLatestBar[]>;
}

export interface HistoricalBarsRequest {
  limit: number;
  end?: Date;
}

interface AlpacaLatestBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export class AlpacaIexMarketDataClient {
  private readonly fetchImpl: AlpacaFetch;

  constructor(
    private readonly config: AlpacaIexMarketDataConfig,
    fetchImpl: AlpacaFetch = fetch,
    private readonly retryConfig: AlpacaRetryConfig = {}
  ) {
    this.fetchImpl = fetchImpl;
  }

  async getLatestBars(symbols = this.config.symbols): Promise<Candle[]> {
    if (symbols.length === 0) {
      throw new Error("At least one symbol is required for Alpaca latest bars.");
    }

    const url = new URL("/v2/stocks/bars/latest", this.config.baseUrl);
    url.searchParams.set("symbols", symbols.join(","));
    url.searchParams.set("feed", this.config.feed);

    const { response, body } = await requestWithAlpacaRetry(
      () =>
        this.fetchImpl(url.toString(), {
          method: "GET",
          headers: {
            "APCA-API-KEY-ID": this.config.apiKeyId,
            "APCA-API-SECRET-KEY": this.config.apiSecretKey
          }
        }),
      this.retryConfig
    );

    if (!response.ok) {
      throw new Error(
        `Alpaca latest bars request failed with ${response.status} ${response.statusText}: ${body}`
      );
    }

    return parseLatestBarsResponse(JSON.parse(body) as unknown, symbols);
  }

  async getHistoricalBars(
    symbols = this.config.symbols,
    request: HistoricalBarsRequest
  ): Promise<Candle[]> {
    if (symbols.length === 0) {
      throw new Error("At least one symbol is required for Alpaca historical bars.");
    }
    if (!Number.isInteger(request.limit) || request.limit <= 0 || request.limit > 10_000) {
      throw new Error("Alpaca historical bars limit must be an integer from 1 through 10000.");
    }
    if (request.end && Number.isNaN(request.end.getTime())) {
      throw new Error("Alpaca historical bars end must be a valid date.");
    }

    const responses = await Promise.all(
      symbols.map(async (requestedSymbol) => {
        const symbol = requestedSymbol.toUpperCase();
        const url = new URL("/v2/stocks/bars", this.config.baseUrl);
        url.searchParams.set("symbols", symbol);
        url.searchParams.set("timeframe", "1Min");
        url.searchParams.set("feed", this.config.feed);
        url.searchParams.set("limit", String(request.limit));
        url.searchParams.set("sort", "desc");
        const end = request.end ?? new Date();
        const tradingWeeks = Math.ceil(request.limit / 390);
        const lookbackDays = Math.max(7, tradingWeeks * 7 + 7);
        url.searchParams.set(
          "start",
          new Date(end.getTime() - lookbackDays * 86_400_000).toISOString()
        );
        url.searchParams.set("end", end.toISOString());

        const { response, body } = await requestWithAlpacaRetry(
          () =>
            this.fetchImpl(url.toString(), {
              method: "GET",
              headers: {
                "APCA-API-KEY-ID": this.config.apiKeyId,
                "APCA-API-SECRET-KEY": this.config.apiSecretKey
              }
            }),
          this.retryConfig
        );
        if (!response.ok) {
          throw new Error(
            `Alpaca historical bars request failed with ${response.status} ${response.statusText}: ${body}`
          );
        }
        return parseHistoricalBarsResponse(JSON.parse(body) as unknown, [symbol]);
      })
    );

    return responses
      .flat()
      .sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
  }
}

export function parseLatestBarsResponse(raw: unknown, requestedSymbols: string[]): Candle[] {
  const response = objectValue(
    raw,
    "Alpaca latest bars response"
  ) as unknown as Partial<AlpacaLatestBarsResponse>;
  const bars = objectValue(response.bars, "Alpaca latest bars response.bars");

  return requestedSymbols.map((requestedSymbol) => {
    const symbol = requestedSymbol.toUpperCase();
    const bar = objectValue(
      bars[symbol],
      `Alpaca latest bar ${symbol}`
    ) as unknown as Partial<AlpacaLatestBar>;
    const openTime = dateValue(bar.t, `Alpaca latest bar ${symbol}.t`);

    return {
      symbol,
      timeframe: "1m",
      openTime,
      closeTime: new Date(openTime.getTime() + 60_000),
      open: numberValue(bar.o, `Alpaca latest bar ${symbol}.o`),
      high: numberValue(bar.h, `Alpaca latest bar ${symbol}.h`),
      low: numberValue(bar.l, `Alpaca latest bar ${symbol}.l`),
      close: numberValue(bar.c, `Alpaca latest bar ${symbol}.c`),
      volume: numberValue(bar.v, `Alpaca latest bar ${symbol}.v`)
    };
  });
}

export function parseHistoricalBarsResponse(raw: unknown, requestedSymbols: string[]): Candle[] {
  const response = objectValue(
    raw,
    "Alpaca historical bars response"
  ) as unknown as Partial<AlpacaHistoricalBarsResponse>;
  const bars = objectValue(response.bars, "Alpaca historical bars response.bars");

  return requestedSymbols
    .flatMap((requestedSymbol) => {
      const symbol = requestedSymbol.toUpperCase();
      const symbolBars = bars[symbol];
      if (symbolBars === undefined) return [];
      if (!Array.isArray(symbolBars)) {
        throw new Error(`Alpaca historical bars response.bars.${symbol} must be an array.`);
      }
      return symbolBars.map((rawBar, index) => {
        const label = `Alpaca historical bar ${symbol}[${index}]`;
        const bar = objectValue(rawBar, label) as unknown as Partial<AlpacaLatestBar>;
        const openTime = dateValue(bar.t, `${label}.t`);
        return {
          symbol,
          timeframe: "1m" as const,
          openTime,
          closeTime: new Date(openTime.getTime() + 60_000),
          open: numberValue(bar.o, `${label}.o`),
          high: numberValue(bar.h, `${label}.h`),
          low: numberValue(bar.l, `${label}.l`),
          close: numberValue(bar.c, `${label}.c`),
          volume: numberValue(bar.v, `${label}.v`)
        };
      });
    })
    .sort((left, right) => left.openTime.getTime() - right.openTime.getTime());
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function dateValue(value: unknown, label: string): Date {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string timestamp.`);
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid timestamp.`);
  }

  return date;
}
