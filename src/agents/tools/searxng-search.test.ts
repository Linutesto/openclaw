import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSearxngSearchTool } from "./searxng-search.js";

describe("searxng_search response sanitization", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("SEARXNG_URL", "http://localhost:18080");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error restore global fetch
    global.fetch = priorFetch;
  });

  it("accepts raw string args as the query", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createSearxngSearchTool({ config: undefined, sandboxed: true });
    const result = await tool?.execute?.("call", "ai automation");
    const details = result?.details as { error?: string } | undefined;

    expect(details?.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalled();
    const url = new URL(mockFetch.mock.calls[0]?.[0] as string);
    expect(url.searchParams.get("q")).toBe("ai automation");
  });

  it("does not fail when searxng returns non-string fields", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            number_of_results: 1,
            results: [
              {
                title: { raw: "structured title" },
                url: "https://example.com/item",
                content: ["snippet", 123],
                engine: 17,
                publishedDate: { at: "2026-02-06" },
                category: true,
              },
            ],
            answers: [42, { type: "answer" }],
            suggestions: [false, ["nested"]],
            corrections: [{ correction: "x" }],
            infoboxes: [{ infobox: { k: "v" }, content: ["a", "b"], urls: [] }],
          }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createSearxngSearchTool({
      config: { tools: { web: { searxng: { cacheTtlMinutes: 0 } } } },
      sandboxed: true,
    });
    const result = await tool?.execute?.("call", { query: "ai automation mixed payload" });
    const details = result?.details as
      | {
          error?: string;
          results?: Array<{ title?: string; snippet?: string; engine?: string }>;
          answers?: string[];
        }
      | undefined;

    expect(details?.error).toBeUndefined();
    expect(details?.results?.[0]?.title).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(details?.results?.[0]?.snippet).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
    expect(details?.results?.[0]?.engine).toBe("17");
    expect(details?.answers?.[0]).toContain("<<<EXTERNAL_UNTRUSTED_CONTENT>>>");
  });
});
