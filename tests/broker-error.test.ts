import { describe, expect, it } from "vitest";
import { sanitizedExternalErrorDetail } from "../src/observability/external-error-sanitizer.js";

describe("broker error sanitization", () => {
  it("keeps only broker code and message from JSON payloads", () => {
    expect(
      sanitizedExternalErrorDetail(
        JSON.stringify({ code: 4031, message: "denied", account_id: "sensitive" })
      )
    ).toBe('{"code":4031,"message":"denied"}');
  });

  it("redacts and bounds unstructured secret-like values", () => {
    const detail = sanitizedExternalErrorDetail(`api_key=abc secret:xyz ${"x".repeat(1000)}`);
    expect(detail).toContain("api_key=[REDACTED]");
    expect(detail).toContain("secret=[REDACTED]");
    expect(detail.length).toBeLessThanOrEqual(500);
  });
});
