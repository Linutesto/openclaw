import { describe, expect, it } from "vitest";
import { __testing } from "./web-discover.js";

const { resolveRequestedMaxPages } = __testing;

describe("web_discover depth/page resolution", () => {
  it("uses surface mode as search-only", () => {
    expect(resolveRequestedMaxPages({ searchDepth: "surface", configuredDefault: 4 })).toBe(0);
  });

  it("uses deep mode fallback when no explicit maxPages is provided", () => {
    expect(resolveRequestedMaxPages({ searchDepth: "deep", configuredDefault: 0 })).toBe(3);
    expect(resolveRequestedMaxPages({ searchDepth: "deep", configuredDefault: 7 })).toBe(7);
  });

  it("prioritizes explicit maxPages over depth defaults", () => {
    expect(
      resolveRequestedMaxPages({ searchDepth: "deep", maxPages: 1, configuredDefault: 5 }),
    ).toBe(1);
    expect(
      resolveRequestedMaxPages({ searchDepth: "surface", maxPages: 2, configuredDefault: 5 }),
    ).toBe(2);
  });
});
