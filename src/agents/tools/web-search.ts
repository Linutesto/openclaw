import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { fetchWithSsrFGuard } from "../../infra/net/fetch-guard.js";
import { wrapWebContent } from "../../security/external-content.js";
import { jsonResult, readBooleanParam, readNumberParam, readStringParam } from "./common.js";
import { extractReadableContent, htmlToMarkdown, truncateText } from "./web-fetch-utils.js";
import {
  CacheEntry,
  DEFAULT_CACHE_TTL_MINUTES,
  DEFAULT_TIMEOUT_SECONDS,
  normalizeCacheKey,
  readCache,
  readResponseText,
  resolveCacheTtlMs,
  resolveTimeoutSeconds,
  withTimeout,
  writeCache,
} from "./web-shared.js";

const DEFAULT_SEARXNG_BASE_URL = "http://localhost:8080";
const DEFAULT_SEARCH_COUNT = 10;
const MAX_SEARCH_COUNT = 50;
const DEFAULT_RATE_LIMIT_MS = 1_000;
const DEFAULT_CRAWL_PAGES = 0;
const MAX_CRAWL_PAGES = 10;
const DEFAULT_MAX_CONTENT_CHARS = 10_000;
const DEFAULT_FETCH_TIMEOUT_SECONDS = 15;

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
let lastSearchRequestAt = 0;

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  searchDepth: Type.Optional(
    Type.String({
      description:
        'Search mode: "surface" (search-only, fast scan) or "deep" (search + crawl top pages). Prefer explicit searchDepth over implicit defaults.',
    }),
  ),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-50).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  categories: Type.Optional(
    Type.String({
      description: 'Comma-separated search categories (e.g., "general", "news", "science", "it").',
    }),
  ),
  engines: Type.Optional(
    Type.String({
      description: 'Comma-separated engines (e.g., "google,duckduckgo,bing").',
    }),
  ),
  language: Type.Optional(
    Type.String({
      description: 'Search language code (e.g., "en", "de", "fr").',
    }),
  ),
  time_range: Type.Optional(
    Type.String({
      description: 'Time filter: "day", "week", "month", "year".',
    }),
  ),
  safesearch: Type.Optional(
    Type.Number({
      description: "Safe search level: 0 (off), 1 (moderate), 2 (strict).",
      minimum: 0,
      maximum: 2,
    }),
  ),
  crawlPages: Type.Optional(
    Type.Number({
      description:
        "How many top results to fetch/extract (0-10). 0 = surface search. >0 = deep search. searchDepth still controls intent.",
      minimum: 0,
      maximum: MAX_CRAWL_PAGES,
    }),
  ),
  extractMode: Type.Optional(
    Type.String({
      description: 'Extraction mode when crawlPages > 0: "markdown" or "text". Default: markdown.',
    }),
  ),
  maxContentChars: Type.Optional(
    Type.Number({
      description: "Maximum extracted characters per crawled page (100-50000).",
      minimum: 100,
      maximum: 50_000,
    }),
  ),
  includeRawResults: Type.Optional(
    Type.Boolean({
      description:
        "Include uncrawled results as skipped entries when crawlPages < count. Default: true.",
    }),
  ),
});

type SearxSearchConfig = {
  enabled?: boolean;
  baseUrl?: string;
  maxResults?: number;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
  rateLimitMs?: number;
  defaultCrawlPages?: number;
  maxCrawlPages?: number;
  defaultExtractMode?: "markdown" | "text";
  defaultMaxContentChars?: number;
  crawlTimeoutSeconds?: number;
};

type SearxSearchResult = {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  publishedDate?: string;
  category?: string;
};

type SearxSearchResponse = {
  number_of_results?: number;
  results?: SearxSearchResult[];
  answers?: string[];
  corrections?: string[];
  infoboxes?: Array<{
    infobox?: string;
    content?: string;
    urls?: Array<{ title?: string; url?: string }>;
  }>;
  suggestions?: string[];
  unresponsive_engines?: string[][];
};

type SearchHit = {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
  publishedDate?: string;
  category?: string;
};

type CrawledPage = {
  url: string;
  title: string;
  snippet: string;
  fetchStatus: "success" | "failed" | "skipped";
  content?: string;
  contentLength?: number;
  contentTruncated?: boolean;
  extractMode?: "markdown" | "text";
  tookMs?: number;
  fetchError?: string;
};

type SearchDepth = "surface" | "deep";

function resolveSearchConfig(cfg?: OpenClawConfig): SearxSearchConfig | undefined {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") {
    return undefined;
  }
  return search as SearxSearchConfig;
}

function resolveSearchEnabled(params: {
  search?: SearxSearchConfig;
  sandboxed?: boolean;
}): boolean {
  if (typeof params.search?.enabled === "boolean") {
    return params.search.enabled;
  }
  return true;
}

function resolveSearxngBaseUrl(search?: SearxSearchConfig): string {
  const fromConfig = search?.baseUrl?.trim();
  const fromEnv = process.env.SEARXNG_URL?.trim();
  return fromConfig || fromEnv || DEFAULT_SEARXNG_BASE_URL;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
}

function resolveCrawlPages(
  value: unknown,
  fallback: number,
  configuredMax: number | undefined,
): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const max = Math.max(0, Math.min(MAX_CRAWL_PAGES, Math.floor(configuredMax ?? MAX_CRAWL_PAGES)));
  return Math.max(0, Math.min(max, Math.floor(parsed)));
}

function resolveRequestedCrawlPages(params: {
  crawlPages?: number;
  searchDepth?: SearchDepth;
  configuredDefault?: number;
  configuredMax?: number;
}): number {
  const configuredFallback = params.configuredDefault ?? DEFAULT_CRAWL_PAGES;
  if (typeof params.crawlPages === "number" && Number.isFinite(params.crawlPages)) {
    return resolveCrawlPages(params.crawlPages, configuredFallback, params.configuredMax);
  }
  if (params.searchDepth === "surface") {
    return 0;
  }
  if (params.searchDepth === "deep") {
    const deepFallback = configuredFallback > 0 ? configuredFallback : 3;
    return resolveCrawlPages(deepFallback, deepFallback, params.configuredMax);
  }
  return resolveCrawlPages(undefined, configuredFallback, params.configuredMax);
}

function resolveMaxContentChars(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(100, Math.min(50_000, Math.floor(parsed)));
}

async function searchSearxng(params: {
  query: string;
  count: number;
  baseUrl: string;
  timeoutSeconds: number;
  rateLimitMs: number;
  categories?: string;
  engines?: string;
  language?: string;
  time_range?: string;
  safesearch?: number;
}): Promise<{ hits: SearchHit[]; raw: SearxSearchResponse }> {
  const elapsed = Date.now() - lastSearchRequestAt;
  if (elapsed < params.rateLimitMs && lastSearchRequestAt > 0) {
    await new Promise((resolve) => setTimeout(resolve, params.rateLimitMs - elapsed));
  }
  lastSearchRequestAt = Date.now();

  const url = new URL("/search", params.baseUrl);
  url.searchParams.set("q", params.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageno", "1");

  if (params.categories) {
    url.searchParams.set("categories", params.categories);
  }
  if (params.engines) {
    url.searchParams.set("engines", params.engines);
  }
  if (params.language) {
    url.searchParams.set("language", params.language);
  }
  if (params.time_range) {
    url.searchParams.set("time_range", params.time_range);
  }
  if (typeof params.safesearch === "number") {
    url.searchParams.set("safesearch", String(params.safesearch));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "OpenClaw/1.0 (web_search)",
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`SearX search failed (${res.status}): ${detail || res.statusText}`);
  }

  const raw = (await res.json()) as SearxSearchResponse;
  const rows = Array.isArray(raw.results) ? raw.results.slice(0, params.count) : [];
  const hits = rows.map((row) => ({
    title: row.title ? wrapWebContent(row.title, "web_search") : "",
    url: row.url ?? "",
    snippet: row.content ? wrapWebContent(row.content, "web_search") : "",
    engine: row.engine ?? undefined,
    publishedDate: row.publishedDate ?? undefined,
    category: row.category ?? undefined,
  }));

  return { hits, raw };
}

async function fetchAndExtract(params: {
  url: string;
  extractMode: "markdown" | "text";
  maxChars: number;
  timeoutSeconds: number;
}): Promise<{ title?: string; text: string; tookMs: number }> {
  const start = Date.now();
  const guarded = await fetchWithSsrFGuard({
    url: params.url,
    timeoutMs: params.timeoutSeconds * 1000,
    maxRedirects: 3,
    init: {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,*/*",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    },
  });

  try {
    const res = guarded.response;
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const tookMs = Date.now() - start;

    if (contentType.includes("text/html") || body.trimStart().startsWith("<!")) {
      const readable = await extractReadableContent({
        html: body,
        url: params.url,
        extractMode: params.extractMode,
      });

      if (readable?.text) {
        const truncated = truncateText(readable.text, params.maxChars);
        return { title: readable.title, text: truncated.text, tookMs };
      }

      const converted = htmlToMarkdown(body);
      const truncated = truncateText(converted.text, params.maxChars);
      return { title: converted.title, text: truncated.text, tookMs };
    }

    const truncated = truncateText(body, params.maxChars);
    return { text: truncated.text, tookMs };
  } finally {
    await guarded.release();
  }
}

async function runWebSearch(params: {
  query: string;
  count: number;
  baseUrl: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  rateLimitMs: number;
  categories?: string;
  engines?: string;
  language?: string;
  time_range?: string;
  safesearch?: number;
  crawlPages: number;
  extractMode: "markdown" | "text";
  maxContentChars: number;
  includeRawResults: boolean;
  crawlTimeoutSeconds: number;
  searchDepth: SearchDepth;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    [
      "searx",
      params.baseUrl,
      params.query,
      String(params.count),
      params.categories ?? "",
      params.engines ?? "",
      params.language ?? "",
      params.time_range ?? "",
      typeof params.safesearch === "number" ? String(params.safesearch) : "",
      String(params.crawlPages),
      params.extractMode,
      String(params.maxContentChars),
      params.includeRawResults ? "1" : "0",
    ].join(":"),
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();
  const { hits, raw } = await searchSearxng({
    query: params.query,
    count: params.count,
    baseUrl: params.baseUrl,
    timeoutSeconds: params.timeoutSeconds,
    rateLimitMs: params.rateLimitMs,
    categories: params.categories,
    engines: params.engines,
    language: params.language,
    time_range: params.time_range,
    safesearch: params.safesearch,
  });

  const payload: Record<string, unknown> = {
    query: params.query,
    searchDepth: params.searchDepth,
    provider: "searxng",
    baseUrl: params.baseUrl,
    count: hits.length,
    totalResults: raw.number_of_results,
    tookMs: Date.now() - start,
    results: hits,
  };

  if (raw.answers && raw.answers.length > 0) {
    payload.answers = raw.answers.map((entry) => wrapWebContent(entry, "web_search"));
  }
  if (raw.suggestions && raw.suggestions.length > 0) {
    payload.suggestions = raw.suggestions.map((entry) => wrapWebContent(entry, "web_search"));
  }
  if (raw.corrections && raw.corrections.length > 0) {
    payload.corrections = raw.corrections.map((entry) => wrapWebContent(entry, "web_search"));
  }
  if (raw.unresponsive_engines && raw.unresponsive_engines.length > 0) {
    payload.unresponsiveEngines = raw.unresponsive_engines;
  }
  if (raw.infoboxes && raw.infoboxes.length > 0) {
    payload.infoboxes = raw.infoboxes.map((entry) => ({
      title: entry.infobox ? wrapWebContent(entry.infobox, "web_search") : undefined,
      content: entry.content ? wrapWebContent(entry.content, "web_search") : undefined,
      urls: entry.urls,
    }));
  }

  if (params.crawlPages > 0 && hits.length > 0) {
    const pagesToFetch = Math.min(params.crawlPages, hits.length);
    const pages = await Promise.all(
      hits.slice(0, pagesToFetch).map(async (hit): Promise<CrawledPage> => {
        const page: CrawledPage = {
          url: hit.url,
          title: hit.title,
          snippet: hit.snippet,
          fetchStatus: "skipped",
        };

        try {
          const extracted = await fetchAndExtract({
            url: hit.url,
            extractMode: params.extractMode,
            maxChars: params.maxContentChars,
            timeoutSeconds: params.crawlTimeoutSeconds,
          });
          page.title = extracted.title ? wrapWebContent(extracted.title, "web_search") : hit.title;
          page.content = wrapWebContent(extracted.text, "web_search");
          page.contentLength = extracted.text.length;
          page.contentTruncated = extracted.text.length >= params.maxContentChars;
          page.fetchStatus = "success";
          page.extractMode = params.extractMode;
          page.tookMs = extracted.tookMs;
        } catch (error) {
          page.fetchStatus = "failed";
          page.fetchError = error instanceof Error ? error.message : String(error);
        }

        return page;
      }),
    );

    if (params.includeRawResults && hits.length > pagesToFetch) {
      for (const hit of hits.slice(pagesToFetch)) {
        pages.push({
          url: hit.url,
          title: hit.title,
          snippet: hit.snippet,
          fetchStatus: "skipped",
        });
      }
    }

    const pagesSucceeded = pages.filter((entry) => entry.fetchStatus === "success").length;
    const pagesFailed = pages.filter((entry) => entry.fetchStatus === "failed").length;

    payload.crawl = {
      requested: params.crawlPages,
      fetched: pagesToFetch,
      succeeded: pagesSucceeded,
      failed: pagesFailed,
      extractMode: params.extractMode,
      maxContentChars: params.maxContentChars,
      pages,
    };
    payload.tookMs = Date.now() - start;
  }

  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createWebSearchTool(options?: {
  config?: OpenClawConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) {
    return null;
  }

  const baseUrl = resolveSearxngBaseUrl(search);

  return {
    label: "Web Search",
    name: "web_search",
    description:
      'Search the web using local SearX. Surface mode: {query, searchDepth:"surface", count}. Deep mode: {query, searchDepth:"deep", crawlPages}.',
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const searchDepthRaw = readStringParam(params, "searchDepth");
      const count = readNumberParam(params, "count", { integer: true });
      const categories = readStringParam(params, "categories");
      const engines = readStringParam(params, "engines");
      const language = readStringParam(params, "language");
      const time_range = readStringParam(params, "time_range");
      const safesearch = readNumberParam(params, "safesearch", { integer: true });
      const crawlPages = readNumberParam(params, "crawlPages", { integer: true });
      const extractModeRaw = readStringParam(params, "extractMode");
      const maxContentChars = readNumberParam(params, "maxContentChars", { integer: true });
      const includeRawResults = readBooleanParam(params, "includeRawResults");
      const searchDepth =
        searchDepthRaw?.trim().toLowerCase() === "surface" ||
        searchDepthRaw?.trim().toLowerCase() === "deep"
          ? (searchDepthRaw.trim().toLowerCase() as SearchDepth)
          : undefined;

      const extractMode: "markdown" | "text" = extractModeRaw === "text" ? "text" : "markdown";
      if (extractModeRaw && extractModeRaw !== "markdown" && extractModeRaw !== "text") {
        return jsonResult({
          error: "invalid_extract_mode",
          message: 'extractMode must be either "markdown" or "text".',
        });
      }
      if (searchDepthRaw && !searchDepth) {
        return jsonResult({
          error: "invalid_search_depth",
          message: 'searchDepth must be either "surface" or "deep".',
        });
      }

      const resolvedCrawlPages = resolveRequestedCrawlPages({
        crawlPages,
        searchDepth,
        configuredDefault: search?.defaultCrawlPages,
        configuredMax: search?.maxCrawlPages,
      });
      const resolvedSearchDepth: SearchDepth = resolvedCrawlPages > 0 ? "deep" : "surface";

      try {
        const result = await runWebSearch({
          query,
          count: resolveSearchCount(count ?? search?.maxResults, DEFAULT_SEARCH_COUNT),
          baseUrl,
          timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
          cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
          rateLimitMs:
            typeof search?.rateLimitMs === "number" && Number.isFinite(search.rateLimitMs)
              ? Math.max(0, Math.floor(search.rateLimitMs))
              : DEFAULT_RATE_LIMIT_MS,
          categories,
          engines,
          language,
          time_range,
          safesearch: typeof safesearch === "number" ? safesearch : undefined,
          crawlPages: resolvedCrawlPages,
          searchDepth: resolvedSearchDepth,
          extractMode: extractModeRaw
            ? extractMode
            : search?.defaultExtractMode === "text"
              ? "text"
              : "markdown",
          maxContentChars: resolveMaxContentChars(
            maxContentChars,
            search?.defaultMaxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
          ),
          includeRawResults: includeRawResults ?? true,
          crawlTimeoutSeconds: resolveTimeoutSeconds(
            search?.crawlTimeoutSeconds,
            DEFAULT_FETCH_TIMEOUT_SECONDS,
          ),
        });
        return jsonResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({
          error: "web_search_failed",
          message,
          hint: `Ensure SearX is reachable at ${baseUrl}. Configure via tools.web.search.baseUrl or SEARXNG_URL.`,
          nextStep:
            'Use web_search for surface/deep search (searchDepth: surface|deep). For deeper synthesis, use web_discover {query, searchDepth:"deep", maxPages}. Avoid exec+curl+jq unless explicitly requested.',
        });
      }
    },
  };
}

export const __testing = {
  resolveSearxngBaseUrl,
  resolveSearchCount,
  resolveCrawlPages,
  resolveRequestedCrawlPages,
} as const;
