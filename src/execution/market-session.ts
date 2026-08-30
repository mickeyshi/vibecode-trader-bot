export interface MarketSessionConfig {
  enabled: boolean;
  timeZone: string;
  openTime: string;
  closeTime: string;
  weekdays: number[];
  holidays: string[];
}

export interface MarketSessionStatus {
  isOpen: boolean;
  reason?: string;
  localDate: string;
  localTime: string;
}

export interface MarketCalendarDay {
  date: string;
  openTime: string;
  closeTime: string;
}

interface ZonedDateTimeParts {
  date: string;
  time: string;
  weekday: number;
  minutesSinceMidnight: number;
}

const WEEKDAY_BY_NAME: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7
};

export function regularUsEquitiesMarketSession(
  overrides: Partial<MarketSessionConfig> = {}
): MarketSessionConfig {
  return {
    enabled: true,
    timeZone: "America/New_York",
    openTime: "09:30",
    closeTime: "16:00",
    weekdays: [1, 2, 3, 4, 5],
    holidays: [],
    ...overrides
  };
}

export function marketSessionStatus(now: Date, config: MarketSessionConfig): MarketSessionStatus {
  validateMarketSessionConfig(config);

  const zoned = zonedDateTimeParts(now, config.timeZone);
  if (!config.enabled) {
    return {
      isOpen: true,
      localDate: zoned.date,
      localTime: zoned.time
    };
  }

  if (!config.weekdays.includes(zoned.weekday)) {
    return {
      isOpen: false,
      reason: `${zoned.date} is outside configured trading weekdays.`,
      localDate: zoned.date,
      localTime: zoned.time
    };
  }

  if (config.holidays.includes(zoned.date)) {
    return {
      isOpen: false,
      reason: `${zoned.date} is a configured market holiday.`,
      localDate: zoned.date,
      localTime: zoned.time
    };
  }

  const openMinutes = parseSessionTime(config.openTime);
  const closeMinutes = parseSessionTime(config.closeTime);
  if (zoned.minutesSinceMidnight < openMinutes) {
    return {
      isOpen: false,
      reason: `${zoned.time} ${config.timeZone} is before the configured ${config.openTime} open.`,
      localDate: zoned.date,
      localTime: zoned.time
    };
  }

  if (zoned.minutesSinceMidnight >= closeMinutes) {
    return {
      isOpen: false,
      reason: `${zoned.time} ${config.timeZone} is at or after the configured ${config.closeTime} close.`,
      localDate: zoned.date,
      localTime: zoned.time
    };
  }

  return {
    isOpen: true,
    localDate: zoned.date,
    localTime: zoned.time
  };
}

function validateMarketSessionConfig(config: MarketSessionConfig): void {
  parseSessionTime(config.openTime);
  parseSessionTime(config.closeTime);

  if (parseSessionTime(config.closeTime) <= parseSessionTime(config.openTime)) {
    throw new Error("Market session closeTime must be after openTime.");
  }

  if (config.weekdays.length === 0) {
    throw new Error("Market session weekdays must include at least one weekday.");
  }

  for (const weekday of config.weekdays) {
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      throw new Error("Market session weekdays must use integers from 1 through 7.");
    }
  }

  for (const holiday of config.holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(holiday)) {
      throw new Error("Market session holidays must use YYYY-MM-DD dates.");
    }
  }

  try {
    zonedDateTimeParts(new Date("2026-01-02T15:00:00.000Z"), config.timeZone);
  } catch (error) {
    throw new Error(
      `Market session timeZone is invalid: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function parseSessionTime(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    throw new Error("Market session times must use HH:MM in 24-hour format.");
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function zonedDateTimeParts(now: Date, timeZone: string): ZonedDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value])
  );
  const year = requirePart(parts, "year");
  const month = requirePart(parts, "month");
  const day = requirePart(parts, "day");
  const hour = Number(requirePart(parts, "hour")) % 24;
  const minute = Number(requirePart(parts, "minute"));
  const weekdayName = requirePart(parts, "weekday");
  const weekday = WEEKDAY_BY_NAME[weekdayName];

  if (weekday === undefined) {
    throw new Error(`Unsupported weekday value ${weekdayName}.`);
  }

  return {
    date: `${year}-${month}-${day}`,
    time: `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`,
    weekday,
    minutesSinceMidnight: hour * 60 + minute
  };
}

function requirePart(parts: Record<string, string>, key: string): string {
  const value = parts[key];
  if (!value) {
    throw new Error(`Unable to resolve ${key} for configured market session.`);
  }

  return value;
}
