import { describe, expect, it } from "vitest";
import { validateConfigObject } from "./config.js";

describe("web search config", () => {
  it("accepts local SearX-backed web_search config", () => {
    const res = validateConfigObject({
      tools: {
        web: {
          search: {
            enabled: true,
            baseUrl: "http://localhost:8080",
            maxResults: 20,
            timeoutSeconds: 15,
            cacheTtlMinutes: 3,
            rateLimitMs: 500,
            defaultCrawlPages: 2,
            maxCrawlPages: 6,
            defaultExtractMode: "markdown",
            defaultMaxContentChars: 8000,
            crawlTimeoutSeconds: 12,
          },
          searxng: {
            enabled: true,
            baseUrl: "http://localhost:8080",
          },
          discover: {
            enabled: true,
            searxngBaseUrl: "http://localhost:8080",
            maxPages: 3,
          },
        },
      },
    });

    expect(res.ok).toBe(true);
  });
});
