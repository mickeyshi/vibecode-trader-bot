import type { TradingMode } from "../core/types.js";

export interface AlpacaTradingConfig {
  apiKeyId: string;
  apiSecretKey: string;
  baseUrl: string;
  mode: Extract<TradingMode, "paper" | "live">;
}

export interface AlpacaTradingConfigEnv {
  ALPACA_TRADING_API_KEY_ID?: string;
  ALPACA_TRADING_API_SECRET_KEY?: string;
  ALPACA_TRADING_BASE_URL?: string;
  ALPACA_TRADING_MODE?: string;
}

const paperBaseUrl = "https://paper-api.alpaca.markets";
const liveBaseUrl = "https://api.alpaca.markets";

export function loadAlpacaTradingConfig(
  env: AlpacaTradingConfigEnv = process.env
): AlpacaTradingConfig {
  const mode = parseTradingMode(env.ALPACA_TRADING_MODE ?? "paper");
  const baseUrl = env.ALPACA_TRADING_BASE_URL ?? (mode === "paper" ? paperBaseUrl : liveBaseUrl);
  validateTradingBaseUrl(mode, baseUrl);

  return {
    apiKeyId: requiredEnv(env.ALPACA_TRADING_API_KEY_ID, "ALPACA_TRADING_API_KEY_ID"),
    apiSecretKey: requiredEnv(env.ALPACA_TRADING_API_SECRET_KEY, "ALPACA_TRADING_API_SECRET_KEY"),
    baseUrl,
    mode
  };
}

export function parseTradingMode(raw: string): AlpacaTradingConfig["mode"] {
  const mode = raw.trim().toLowerCase();
  if (mode === "paper" || mode === "live") {
    return mode;
  }

  throw new Error("ALPACA_TRADING_MODE must be paper or live.");
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required for Alpaca trading.`);
  }

  return value;
}

function validateTradingBaseUrl(mode: AlpacaTradingConfig["mode"], baseUrl: string): void {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  if (mode === "paper" && normalizedBaseUrl === liveBaseUrl) {
    throw new Error("ALPACA_TRADING_BASE_URL must not point at the live Alpaca API in paper mode.");
  }

  if (mode === "live" && normalizedBaseUrl === paperBaseUrl) {
    throw new Error("ALPACA_TRADING_BASE_URL must not point at the paper Alpaca API in live mode.");
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}
