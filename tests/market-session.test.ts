import { describe, expect, it } from "vitest";
import {
  marketSessionStatus,
  regularUsEquitiesMarketSession
} from "../src/execution/market-session.js";

describe("market session", () => {
  it("reports open during a configured weekday session", () => {
    const status = marketSessionStatus(
      new Date("2026-06-24T14:00:00.000Z"),
      regularUsEquitiesMarketSession()
    );

    expect(status).toMatchObject({
      isOpen: true,
      localDate: "2026-06-24",
      localTime: "10:00"
    });
  });

  it("reports closed before the configured open", () => {
    const status = marketSessionStatus(
      new Date("2026-06-24T13:00:00.000Z"),
      regularUsEquitiesMarketSession()
    );

    expect(status).toMatchObject({
      isOpen: false,
      localDate: "2026-06-24",
      localTime: "09:00",
      reason: "09:00 America/New_York is before the configured 09:30 open."
    });
  });

  it("reports closed at or after the configured close", () => {
    const status = marketSessionStatus(
      new Date("2026-06-24T20:00:00.000Z"),
      regularUsEquitiesMarketSession()
    );

    expect(status).toMatchObject({
      isOpen: false,
      localDate: "2026-06-24",
      localTime: "16:00",
      reason: "16:00 America/New_York is at or after the configured 16:00 close."
    });
  });

  it("reports closed on non-configured weekdays", () => {
    const status = marketSessionStatus(
      new Date("2026-06-27T14:00:00.000Z"),
      regularUsEquitiesMarketSession()
    );

    expect(status).toMatchObject({
      isOpen: false,
      localDate: "2026-06-27",
      reason: "2026-06-27 is outside configured trading weekdays."
    });
  });

  it("reports closed on explicitly configured holidays", () => {
    const status = marketSessionStatus(
      new Date("2026-06-24T14:00:00.000Z"),
      regularUsEquitiesMarketSession({ holidays: ["2026-06-24"] })
    );

    expect(status).toMatchObject({
      isOpen: false,
      localDate: "2026-06-24",
      reason: "2026-06-24 is a configured market holiday."
    });
  });

  it("rejects malformed session windows", () => {
    expect(() =>
      marketSessionStatus(
        new Date("2026-06-24T14:00:00.000Z"),
        regularUsEquitiesMarketSession({ openTime: "16:00", closeTime: "09:30" })
      )
    ).toThrow("closeTime must be after openTime");
  });
});
