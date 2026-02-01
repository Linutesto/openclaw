/**
 * Web Discovery Tool
 *
 * Combines local web search (SearXNG) with page fetching and content extraction
 * into a single high-level research tool. Local-first, no external API dependencies.
 *
 * Flow: search query → fetch top results → extract readable content → structured output
 */

import { Type } from "@sinclair/typebox";
import type { OpenPawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam, readBooleanParam } from "./common.js";
import { extractReadableContent, htmlToMarkdown, truncateText } from "./web-fetch-utils.js";
import { DEFAULT_TIMEOUT_SECONDS, resolveTimeoutSeconds, withTimeout } from "./web-shared.js";

const DEFAULT_SEARXNG_BASE_URL = "http://localhost:8080";
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_MAX_PAGES = 3;
const DEFAULT_MAX_CONTENT_CHARS = 10_000;
const DEFAULT_FETCH_TIMEOUT_SECONDS = 15;

const WebDiscoverSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  maxResults: Type.Optional(
    Type.Number({
      description: "Maximum number of search results to return (1-20). Default: 5.",
      minimum: 1,
      maximum: 20,
    }),
  ),
  maxPages: Type.Optional(
    Type.Number({
      description:
        "Maximum number of pages to fetch and extract content from (0-10). Default: 3. Set to 0 to skip fetching.",
      minimum: 0,
      maximum: 10,
    }),
  ),
  maxContentChars: Type.Optional(
    Type.Number({
      description: "Maximum characters of extracted content per page. Default: 10000.",
      minimum: 100,
      maximum: 50000,
    }),
  ),
  categories: Type.Optional(
    Type.String({
      description: 'Search categories: "general", "news", "science", "it", etc.',
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
  extractMode: Type.Optional(
    Type.String({
      description: 'Content extraction mode: "markdown" or "text". Default: "markdown".',
    }),
  ),
  includeRawResults: Type.Optional(
    Type.Boolean({
      description: "Include raw search results even for pages that failed to fetch. Default: true.",
    }),
  ),
});

type WebDiscoverConfig = {
  enabled?: boolean;
  searxngBaseUrl?: string;
  timeoutSeconds?: number;
  fetchTimeoutSeconds?: number;
  cacheTtlMinutes?: number;
  maxResults?: number;
  maxPages?: number;
  maxContentChars?: number;
};

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  engine?: string;
  publishedDate?: string;
};

type DiscoveredPage = {
  url: string;
  title: string;
  snippet: string;
  content?: string;
  contentLength?: number;
  contentTruncated?: boolean;
  fetchStatus: "success" | "failed" | "skipped";
  fetchError?: string;
  extractMode?: string;
  tookMs?: number;
};

function resolveWebDiscoverConfig(cfg?: OpenPawConfig): WebDiscoverConfig | undefined {
  const web = cfg?.tools?.web;
  if (!web || typeof web !== "object") {
    return undefined;
  }
  const discover = "discover" in web ? web.discover : undefined;
  if (!discover || typeof discover !== "object") {
    // Fall back to searxng config for base URL
    const searxng = "searxng" in web ? (web.searxng as { baseUrl?: string }) : undefined;
    return {
      searxngBaseUrl: searxng?.baseUrl,
    };
  }
  return discover as WebDiscoverConfig;
}

function resolveWebDiscoverEnabled(params: {
  config?: WebDiscoverConfig;
  baseUrl?: string;
}): boolean {
  if (typeof params.config?.enabled === "boolean") {
    return params.config.enabled;
  }
  // Enable by default if SearXNG URL is available
  const envUrl = process.env.SEARXNG_URL?.trim();
  return Boolean(params.baseUrl || envUrl);
}

function resolveSearxngBaseUrl(config?: WebDiscoverConfig): string {
  const fromConfig = config?.searxngBaseUrl?.trim();
  const fromEnv = process.env.SEARXNG_URL?.trim();
  return fromConfig || fromEnv || DEFAULT_SEARXNG_BASE_URL;
}

async function searchSearxng(params: {
  query: string;
  maxResults: number;
  baseUrl: string;
  timeoutSeconds: number;
  categories?: string;
  language?: string;
  time_range?: string;
}): Promise<SearchResult[]> {
  const url = new URL("/search", params.baseUrl);
  url.searchParams.set("q", params.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("pageno", "1");

  if (params.categories) {
    url.searchParams.set("categories", params.categories);
  }
  if (params.language) {
    url.searchParams.set("language", params.language);
  }
  if (params.time_range) {
    url.searchParams.set("time_range", params.time_range);
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "OpenPaw/1.0 (Web Discovery)",
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    throw new Error(`SearXNG search failed (${res.status})`);
  }

  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
      engine?: string;
      publishedDate?: string;
    }>;
  };

  const results = Array.isArray(data.results) ? data.results : [];
  return results.slice(0, params.maxResults).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
    engine: r.engine,
    publishedDate: r.publishedDate,
  }));
}

async function fetchAndExtract(params: {
  url: string;
  extractMode: "markdown" | "text";
  maxChars: number;
  timeoutSeconds: number;
}): Promise<{ title?: string; content: string; tookMs: number }> {
  const start = Date.now();

  const res = await fetch(params.url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml,*/*",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const tookMs = Date.now() - start;

  // Handle HTML content
  if (contentType.includes("text/html") || body.trimStart().startsWith("<!")) {
    const readable = await extractReadableContent({
      html: body,
      url: params.url,
      extractMode: params.extractMode,
    });

    if (readable?.text) {
      return {
        title: readable.title,
        content: readable.text,
        tookMs,
      };
    }

    // Fallback: convert HTML to markdown directly
    const converted = htmlToMarkdown(body);
    return {
      title: converted.title,
      content: converted.text,
      tookMs,
    };
  }

  // Handle JSON
  if (contentType.includes("application/json")) {
    try {
      return {
        content: JSON.stringify(JSON.parse(body), null, 2),
        tookMs,
      };
    } catch {
      return { content: body, tookMs };
    }
  }

  // Plain text or other
  return { content: body, tookMs };
}

async function runWebDiscover(params: {
  query: string;
  maxResults: number;
  maxPages: number;
  maxContentChars: number;
  baseUrl: string;
  searchTimeoutSeconds: number;
  fetchTimeoutSeconds: number;
  categories?: string;
  language?: string;
  time_range?: string;
  extractMode: "markdown" | "text";
  includeRawResults: boolean;
}): Promise<Record<string, unknown>> {
  const start = Date.now();
  const pages: DiscoveredPage[] = [];

  // Step 1: Search
  let searchResults: SearchResult[];
  try {
    searchResults = await searchSearxng({
      query: params.query,
      maxResults: params.maxResults,
      baseUrl: params.baseUrl,
      timeoutSeconds: params.searchTimeoutSeconds,
      categories: params.categories,
      language: params.language,
      time_range: params.time_range,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: "search_failed",
      message,
      query: params.query,
      hint: `Ensure SearXNG is running at ${params.baseUrl}`,
    };
  }

  if (searchResults.length === 0) {
    return {
      query: params.query,
      provider: "searxng",
      totalResults: 0,
      pages: [],
      tookMs: Date.now() - start,
      message: "No search results found",
    };
  }

  // Step 2: Fetch and extract content from top pages
  const pagesToFetch = Math.min(params.maxPages, searchResults.length);
  const fetchPromises = searchResults.slice(0, pagesToFetch).map(async (result) => {
    const page: DiscoveredPage = {
      url: result.url,
      title: result.title,
      snippet: result.snippet,
      fetchStatus: "skipped",
    };

    if (params.maxPages === 0) {
      return page;
    }

    try {
      const extracted = await fetchAndExtract({
        url: result.url,
        extractMode: params.extractMode,
        maxChars: params.maxContentChars,
        timeoutSeconds: params.fetchTimeoutSeconds,
      });

      const truncated = truncateText(extracted.content, params.maxContentChars);

      page.title = extracted.title || result.title;
      page.content = truncated.text;
      page.contentLength = truncated.text.length;
      page.contentTruncated = truncated.truncated;
      page.fetchStatus = "success";
      page.extractMode = params.extractMode;
      page.tookMs = extracted.tookMs;
    } catch (error) {
      page.fetchStatus = "failed";
      page.fetchError = error instanceof Error ? error.message : String(error);
    }

    return page;
  });

  const fetchedPages = await Promise.all(fetchPromises);
  pages.push(...fetchedPages);

  // Add remaining results without content if includeRawResults is true
  if (params.includeRawResults && searchResults.length > pagesToFetch) {
    for (const result of searchResults.slice(pagesToFetch)) {
      pages.push({
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        fetchStatus: "skipped",
      });
    }
  }

  const successCount = pages.filter((p) => p.fetchStatus === "success").length;
  const failedCount = pages.filter((p) => p.fetchStatus === "failed").length;

  return {
    query: params.query,
    provider: "searxng",
    baseUrl: params.baseUrl,
    totalResults: searchResults.length,
    pagesFetched: pagesToFetch,
    pagesSucceeded: successCount,
    pagesFailed: failedCount,
    extractMode: params.extractMode,
    tookMs: Date.now() - start,
    pages,
  };
}

export function createWebDiscoverTool(options?: {
  config?: OpenPawConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const discoverConfig = resolveWebDiscoverConfig(options?.config);
  const baseUrl = resolveSearxngBaseUrl(discoverConfig);

  if (!resolveWebDiscoverEnabled({ config: discoverConfig, baseUrl })) {
    return null;
  }

  return {
    label: "Web Discovery",
    name: "web_discover",
    description:
      "Research a topic by searching the web and extracting content from top results. Combines local SearXNG search with page fetching and readability extraction. Returns structured results with titles, URLs, snippets, and full page content. Use for comprehensive web research in a single tool call.",
    parameters: WebDiscoverSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults", { integer: true });
      const maxPages = readNumberParam(params, "maxPages", { integer: true });
      const maxContentChars = readNumberParam(params, "maxContentChars", { integer: true });
      const categories = readStringParam(params, "categories");
      const language = readStringParam(params, "language");
      const time_range = readStringParam(params, "time_range");
      const extractModeRaw = readStringParam(params, "extractMode");
      const includeRawResults = readBooleanParam(params, "includeRawResults");

      const extractMode: "markdown" | "text" = extractModeRaw === "text" ? "text" : "markdown";

      const result = await runWebDiscover({
        query,
        maxResults: Math.min(
          Math.max(1, maxResults ?? discoverConfig?.maxResults ?? DEFAULT_MAX_RESULTS),
          20,
        ),
        maxPages: Math.min(
          Math.max(0, maxPages ?? discoverConfig?.maxPages ?? DEFAULT_MAX_PAGES),
          10,
        ),
        maxContentChars: Math.min(
          Math.max(
            100,
            maxContentChars ?? discoverConfig?.maxContentChars ?? DEFAULT_MAX_CONTENT_CHARS,
          ),
          50000,
        ),
        baseUrl,
        searchTimeoutSeconds: resolveTimeoutSeconds(
          discoverConfig?.timeoutSeconds,
          DEFAULT_TIMEOUT_SECONDS,
        ),
        fetchTimeoutSeconds: resolveTimeoutSeconds(
          discoverConfig?.fetchTimeoutSeconds,
          DEFAULT_FETCH_TIMEOUT_SECONDS,
        ),
        categories,
        language,
        time_range,
        extractMode,
        includeRawResults: includeRawResults ?? true,
      });

      return jsonResult(result);
    },
  };
}

export const __testing = {
  resolveSearxngBaseUrl,
  resolveWebDiscoverEnabled,
  searchSearxng,
  fetchAndExtract,
} as const;
