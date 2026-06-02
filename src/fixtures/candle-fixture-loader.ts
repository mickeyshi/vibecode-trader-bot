import { readFile } from "node:fs/promises";
import type { Candle, Timeframe } from "../core/types.js";

export interface CandleFixtureOptions {
  symbol: string;
  timeframe: Timeframe;
}

export async function loadCandlesFromFixture(
  filePath: string,
  options: CandleFixtureOptions
): Promise<Candle[]> {
  const raw = await readFile(filePath, "utf8");

  if (filePath.toLowerCase().endsWith(".json")) {
    return parseCandleJson(raw, options);
  }

  if (filePath.toLowerCase().endsWith(".csv") || filePath.toLowerCase().endsWith(".txt")) {
    return parseCandleCsv(raw, options);
  }

  throw new Error(`Unsupported candle fixture format: ${filePath}`);
}

export function parseCandleCsv(raw: string, options: CandleFixtureOptions): Candle[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const [headerLine, ...rows] = lines;
  if (!headerLine) {
    return [];
  }

  const headers = headerLine.split(",").map((header) => normalizeHeader(header));

  return rows
    .map((row) => parseCsvRow(headers, row, options))
    .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());
}

export function parseCandleJson(raw: string, options: CandleFixtureOptions): Candle[] {
  const parsed = JSON.parse(raw) as unknown;

  if (Array.isArray(parsed)) {
    return parsed
      .map((row) => parseObjectRow(asRecord(row), options))
      .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());
  }

  const record = asRecord(parsed);
  const alphaVantageDaily = record["Time Series (Daily)"];
  if (
    alphaVantageDaily &&
    typeof alphaVantageDaily === "object" &&
    !Array.isArray(alphaVantageDaily)
  ) {
    return Object.entries(alphaVantageDaily)
      .map(([date, row]) => parseObjectRow({ ...asRecord(row), date }, options))
      .sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());
  }

  throw new Error("Unsupported candle JSON shape.");
}

function parseCsvRow(headers: string[], row: string, options: CandleFixtureOptions): Candle {
  const values = row.split(",");
  const record: Record<string, string> = {};

  headers.forEach((header, index) => {
    record[header] = values[index] ?? "";
  });

  return parseObjectRow(record, options);
}

function parseObjectRow(record: Record<string, unknown>, options: CandleFixtureOptions): Candle {
  const timestamp = readOptionalString(record, ["timestamp"]);
  const date = timestamp ?? readString(record, ["date"]);
  const time = readOptionalString(record, ["time"]);
  const closeTime = parseDate(date, time);

  return {
    symbol: readOptionalString(record, ["symbol", "ticker"]) ?? options.symbol,
    timeframe: options.timeframe,
    openTime: closeTime,
    closeTime,
    open: readNumber(record, ["open", "1. open"]),
    high: readNumber(record, ["high", "2. high"]),
    low: readNumber(record, ["low", "3. low"]),
    close: readNumber(record, ["close", "4. close"]),
    volume: readNumber(record, ["volume", "vol", "5. volume"])
  };
}

function normalizeHeader(header: string): string {
  return header.trim().replace(/^<|>$/g, "").toLowerCase();
}

function readString(record: Record<string, unknown>, keys: string[]): string {
  const value = readOptionalString(record, keys);
  if (!value) {
    throw new Error(`Missing required field. Expected one of: ${keys.join(", ")}`);
  }

  return value;
}

function readOptionalString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key] ?? record[normalizeHeader(key)];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function readNumber(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key] ?? record[normalizeHeader(key)];
    const numberValue = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numberValue)) {
      return numberValue;
    }
  }

  throw new Error(`Missing numeric field. Expected one of: ${keys.join(", ")}`);
}

function parseDate(value: string, time?: string): Date {
  const date = isCompactDate(value) ? parseCompactDate(value, time) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid candle timestamp: ${value}`);
  }

  return date;
}

function isCompactDate(value: string): boolean {
  return /^\d{8}$/.test(value);
}

function parseCompactDate(value: string, time = "000000"): Date {
  const year = Number(value.slice(0, 4));
  const monthIndex = Number(value.slice(4, 6)) - 1;
  const day = Number(value.slice(6, 8));
  const hour = Number(time.slice(0, 2));
  const minute = Number(time.slice(2, 4));
  const second = Number(time.slice(4, 6));

  return new Date(Date.UTC(year, monthIndex, day, hour, minute, second));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object row.");
  }

  return value as Record<string, unknown>;
}
