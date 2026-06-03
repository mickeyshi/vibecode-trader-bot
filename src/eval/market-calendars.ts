import type { MarketCalendarId } from "./interfaces.js";

export interface MarketCalendar {
  id: MarketCalendarId;
  isSessionDate(date: Date): boolean;
  countMissingSessions(previous: Date, current: Date): number;
}

export interface MarketCalendarOptions {
  marketCalendar?: MarketCalendarId;
  marketHolidays?: string[];
}

export function createMarketCalendar(options: MarketCalendarOptions = {}): MarketCalendar {
  const id = options.marketCalendar ?? "weekday";
  const holidays = new Set((options.marketHolidays ?? []).map(toDateKey));

  return {
    id,
    isSessionDate(date: Date): boolean {
      return isSessionDate(id, date, holidays);
    },
    countMissingSessions(previous: Date, current: Date): number {
      let missingSessions = 0;
      let cursor = addUtcDays(startOfUtcDay(previous), 1);
      const end = startOfUtcDay(current);

      while (cursor.getTime() < end.getTime()) {
        if (isSessionDate(id, cursor, holidays)) {
          missingSessions += 1;
        }
        cursor = addUtcDays(cursor, 1);
      }

      return missingSessions;
    }
  };
}

export function isMarketCalendarId(value: string): value is MarketCalendarId {
  return value === "weekday" || value === "crypto-24-7";
}

export function validateHolidayDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Holiday dates must use YYYY-MM-DD format: ${value}`);
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || toDateKey(date) !== value) {
    throw new Error(`Invalid holiday date: ${value}`);
  }

  return value;
}

function isSessionDate(id: MarketCalendarId, date: Date, holidays: ReadonlySet<string>): boolean {
  if (holidays.has(toDateKey(date))) {
    return false;
  }

  if (id === "crypto-24-7") {
    return true;
  }

  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function toDateKey(value: string | Date): string {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00.000Z`) : value;
  return date.toISOString().slice(0, 10);
}
