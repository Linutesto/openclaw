/**
 * SearXNG Local Web Search Tool
 *
 * Provides local-first web search via a SearXNG instance.
 * No external API dependencies - runs against your own SearXNG server.
 */

import { Type } from "@sinclair/typebox";
import type { OpenPawConfig } from "../../config/config.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
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

const SEARXNG_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

const SearxngSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-50).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
  categories: Type.Optional(
    Type.String({
      description:
        'Comma-separated search categories (e.g., "general", "images", "news", "science", "files", "it", "social media").',
    }),
  ),
  engines: Type.Optional(
    Type.String({
      description:
        'Comma-separated engines to use (e.g., "google,duckduckgo,bing"). Leave empty for default.',
    }),
  ),
  language: Type.Optional(
    Type.String({
      description: 'Search language code (e.g., "en", "de", "fr"). Default: "en".',
    }),
  ),
  time_range: Type.Optional(
    Type.String({
      description: 'Time filter: "day", "week", "month", "year", or empty for all time.',
    }),
  ),
  safesearch: Type.Optional(
    Type.Number({
      description: "Safe search level: 0 (off), 1 (moderate), 2 (strict). Default: 0.",
      minimum: 0,
      maximum: 2,
    }),
  ),
});

type SearxngConfig = {
  enabled?: boolean;
  baseUrl?: string;
  timeoutSeconds?: number;
  cacheTtlMinutes?: number;
  maxResults?: number;
};

type SearxngSearchResult = {
  title?: string;
  url?: string;
  content?: string;
  engine?: string;
  parsed_url?: string[];
  publishedDate?: string;
  thumbnail?: string;
  category?: string;
};

type SearxngSearchResponse = {
  query?: string;
  number_of_results?: number;
  results?: SearxngSearchResult[];
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

function resolveSearxngConfig(cfg?: OpenPawConfig): SearxngConfig | undefined {
  const web = cfg?.tools?.web;
  if (!web || typeof web !== "object") {
    return undefined;
  }
  const searxng = "searxng" in web ? web.searxng : undefined;
  if (!searxng || typeof searxng !== "object") {
    return undefined;
  }
  return searxng as SearxngConfig;
}

function resolveSearxngEnabled(params: { searxng?: SearxngConfig; baseUrl?: string }): boolean {
  if (typeof params.searxng?.enabled === "boolean") {
    return params.searxng.enabled;
  }
  // Enable by default if baseUrl is configured or env var is set
  const envUrl = process.env.SEARXNG_URL?.trim();
  return Boolean(params.baseUrl || envUrl);
}

function resolveSearxngBaseUrl(searxng?: SearxngConfig): string {
  const fromConfig = searxng?.baseUrl?.trim();
  const fromEnv = process.env.SEARXNG_URL?.trim();
  return fromConfig || fromEnv || DEFAULT_SEARXNG_BASE_URL;
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
}

async function runSearxngSearch(params: {
  query: string;
  count: number;
  baseUrl: string;
  timeoutSeconds: number;
  cacheTtlMs: number;
  categories?: string;
  engines?: string;
  language?: string;
  time_range?: string;
  safesearch?: number;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `searxng:${params.query}:${params.count}:${params.categories || ""}:${params.engines || ""}:${params.language || ""}:${params.time_range || ""}`,
  );
  const cached = readCache(SEARXNG_CACHE, cacheKey);
  if (cached) {
    return { ...cached.value, cached: true };
  }

  const start = Date.now();

  // Build SearXNG search URL
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
      "User-Agent": "OpenPaw/1.0 (Local Agent)",
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`SearXNG search failed (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as SearxngSearchResponse;
  const results = Array.isArray(data.results) ? data.results.slice(0, params.count) : [];

  const mapped = results.map((entry) => ({
    title: entry.title ?? "",
    url: entry.url ?? "",
    snippet: entry.content ?? "",
    engine: entry.engine ?? "",
    publishedDate: entry.publishedDate ?? undefined,
    category: entry.category ?? undefined,
  }));

  const payload: Record<string, unknown> = {
    query: params.query,
    provider: "searxng",
    baseUrl: params.baseUrl,
    count: mapped.length,
    totalResults: data.number_of_results,
    tookMs: Date.now() - start,
    results: mapped,
  };

  // Include answers and suggestions if present
  if (data.answers && data.answers.length > 0) {
    payload.answers = data.answers;
  }
  if (data.suggestions && data.suggestions.length > 0) {
    payload.suggestions = data.suggestions;
  }
  if (data.corrections && data.corrections.length > 0) {
    payload.corrections = data.corrections;
  }
  if (data.infoboxes && data.infoboxes.length > 0) {
    payload.infoboxes = data.infoboxes.map((ib) => ({
      title: ib.infobox,
      content: ib.content,
      urls: ib.urls,
    }));
  }
  if (data.unresponsive_engines && data.unresponsive_engines.length > 0) {
    payload.unresponsiveEngines = data.unresponsive_engines;
  }

  writeCache(SEARXNG_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createSearxngSearchTool(options?: {
  config?: OpenPawConfig;
  sandboxed?: boolean;
}): AnyAgentTool | null {
  const searxng = resolveSearxngConfig(options?.config);
  const baseUrl = resolveSearxngBaseUrl(searxng);

  if (!resolveSearxngEnabled({ searxng, baseUrl })) {
    return null;
  }

  return {
    label: "Local Web Search (SearXNG)",
    name: "searxng_search",
    description:
      "Search the web using a local SearXNG instance. Returns structured results with titles, URLs, snippets, and metadata. Use for privacy-respecting, local-first web research without external API dependencies.",
    parameters: SearxngSearchSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count = readNumberParam(params, "count", { integer: true });
      const categories = readStringParam(params, "categories");
      const engines = readStringParam(params, "engines");
      const language = readStringParam(params, "language");
      const time_range = readStringParam(params, "time_range");
      const safesearch = readNumberParam(params, "safesearch", { integer: true });

      try {
        const result = await runSearxngSearch({
          query,
          count: resolveSearchCount(count ?? searxng?.maxResults, DEFAULT_SEARCH_COUNT),
          baseUrl,
          timeoutSeconds: resolveTimeoutSeconds(searxng?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
          cacheTtlMs: resolveCacheTtlMs(searxng?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
          categories,
          engines,
          language,
          time_range,
          safesearch: typeof safesearch === "number" ? safesearch : undefined,
        });
        return jsonResult(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return jsonResult({
          error: "searxng_search_failed",
          message,
          hint: `Ensure SearXNG is running at ${baseUrl}. Configure via tools.web.searxng.baseUrl or SEARXNG_URL env var.`,
        });
      }
    },
  };
}

export const __testing = {
  resolveSearxngBaseUrl,
  resolveSearxngEnabled,
  resolveSearchCount,
} as const;
