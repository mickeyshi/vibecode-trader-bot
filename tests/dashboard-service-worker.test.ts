import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("dashboard service worker", () => {
  it("never caches live snapshots or API responses", async () => {
    const source = await readFile("src/dashboard/app/public/sw.js", "utf8");

    expect(source).toContain('url.pathname === "/live-ops-snapshot.json"');
    expect(source).toContain('url.pathname.startsWith("/api/")');
  });
});
