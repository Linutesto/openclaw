import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing } from "./web-search.js";

const { resolveSearxngBaseUrl, resolveSearchCount, resolveCrawlPages, resolveRequestedCrawlPages } =
  __testing;

describe("web_search searx base URL resolution", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers configured base URL", () => {
    expect(resolveSearxngBaseUrl({ baseUrl: "http://searx.local:9000" })).toBe(
      "http://searx.local:9000",
    );
  });

  it("falls back to default when config/env are missing", () => {
    vi.stubEnv("SEARXNG_URL", "");
    expect(resolveSearxngBaseUrl(undefined)).toBe("http://localhost:8080");
  });
});

describe("web_search result and crawl bounds", () => {
  it("clamps result count to the supported range", () => {
    expect(resolveSearchCount(0, 10)).toBe(1);
    expect(resolveSearchCount(200, 10)).toBe(50);
    expect(resolveSearchCount(undefined, 7)).toBe(7);
  });

  it("clamps crawl pages with configured max cap", () => {
    expect(resolveCrawlPages(8, 0, 5)).toBe(5);
    expect(resolveCrawlPages(-2, 1, 5)).toBe(0);
    expect(resolveCrawlPages(undefined, 3, 5)).toBe(3);
  });

  it("resolves surface/deep crawl defaults from searchDepth", () => {
    expect(resolveRequestedCrawlPages({ searchDepth: "surface", configuredDefault: 4 })).toBe(0);
    expect(resolveRequestedCrawlPages({ searchDepth: "deep", configuredDefault: 0 })).toBe(3);
    expect(
      resolveRequestedCrawlPages({
        searchDepth: "deep",
        configuredDefault: 8,
        configuredMax: 5,
      }),
    ).toBe(5);
  });
});
