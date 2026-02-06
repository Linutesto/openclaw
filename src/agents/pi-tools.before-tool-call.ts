import type { AnyAgentTool } from "./tools/common.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { normalizeToolName } from "./tool-policy.js";

type HookContext = {
  agentId?: string;
  sessionKey?: string;
};

type HookOutcome = { blocked: true; reason: string } | { blocked: false; params: unknown };

const log = createSubsystemLogger("agents/tools");
const WEB_EXEC_ALLOW_OVERRIDE = "OPENCLAW_ALLOW_WEB_EXEC=1";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readExecCommandFromParams(params: unknown): string | null {
  if (typeof params === "string") {
    const trimmed = params.trim();
    return trimmed ? trimmed : null;
  }
  if (!isPlainObject(params)) {
    return null;
  }
  const candidates = ["command", "cmd", "script", "input"];
  for (const key of candidates) {
    const value = params[key];
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

function hasWebExecBypass(command: string): boolean {
  return command.includes(WEB_EXEC_ALLOW_OVERRIDE) || command.includes("--openclaw-allow-web-exec");
}

function isManualLocalWebSearchCommand(command: string): boolean {
  const hasCurl = /\bcurl\b/i.test(command);
  if (!hasCurl) {
    return false;
  }
  const hasLocalSearchEndpoint =
    /https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/search(?:\?|["'\s]|$)/i.test(command) ||
    /\bSEARXNG_URL\b/.test(command);
  const hasQueryHint = /[?&](?:q|query)=/i.test(command) || /format=json/i.test(command);
  const hasSearxHint = /\bsearx(?:ng)?\b/i.test(command);
  const hasJqPipe = /\|\s*jq\b/i.test(command);
  return (hasLocalSearchEndpoint && (hasQueryHint || hasJqPipe)) || (hasSearxHint && hasQueryHint);
}

function hasJqHexEscape(command: string): boolean {
  return /\bjq\b/i.test(command) && /\\x[0-9a-f]{2}/i.test(command);
}

function resolveBuiltinToolBlockReason(params: {
  toolName: string;
  params: unknown;
}): string | null {
  if (params.toolName !== "exec") {
    return null;
  }
  const command = readExecCommandFromParams(params.params);
  if (!command || hasWebExecBypass(command)) {
    return null;
  }
  if (!isManualLocalWebSearchCommand(command)) {
    return null;
  }

  const lines = [
    "Blocked exec call: use dedicated web tools for web research instead of curl/jq.",
    'Surface search: use web_search with {"query":"...","searchDepth":"surface","count":5}.',
    'Deep search: use web_discover with {"query":"...","searchDepth":"deep","maxPages":3}.',
    'Deep alternative: use web_search with {"query":"...","searchDepth":"deep","crawlPages":3}.',
    `If raw curl/jq is explicitly required, prefix the command with ${WEB_EXEC_ALLOW_OVERRIDE}.`,
  ];
  if (hasJqHexEscape(command)) {
    lines.splice(
      1,
      0,
      "jq tip: jq strings do not support \\xNN escapes; use [] or \\u005B/\\u005D instead.",
    );
  }
  return lines.join("\n");
}

export async function runBeforeToolCallHook(args: {
  toolName: string;
  params: unknown;
  toolCallId?: string;
  ctx?: HookContext;
}): Promise<HookOutcome> {
  const toolName = normalizeToolName(args.toolName || "tool");
  const params = args.params;
  const builtinBlockReason = resolveBuiltinToolBlockReason({ toolName, params });
  if (builtinBlockReason) {
    return { blocked: true, reason: builtinBlockReason };
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_tool_call")) {
    return { blocked: false, params };
  }

  try {
    const normalizedParams = isPlainObject(params) ? params : {};
    const hookResult = await hookRunner.runBeforeToolCall(
      {
        toolName,
        params: normalizedParams,
      },
      {
        toolName,
        agentId: args.ctx?.agentId,
        sessionKey: args.ctx?.sessionKey,
      },
    );

    if (hookResult?.block) {
      return {
        blocked: true,
        reason: hookResult.blockReason || "Tool call blocked by plugin hook",
      };
    }

    if (hookResult?.params && isPlainObject(hookResult.params)) {
      if (isPlainObject(params)) {
        return { blocked: false, params: { ...params, ...hookResult.params } };
      }
      return { blocked: false, params: hookResult.params };
    }
  } catch (err) {
    const toolCallId = args.toolCallId ? ` toolCallId=${args.toolCallId}` : "";
    log.warn(`before_tool_call hook failed: tool=${toolName}${toolCallId} error=${String(err)}`);
  }

  return { blocked: false, params };
}

export function wrapToolWithBeforeToolCallHook(
  tool: AnyAgentTool,
  ctx?: HookContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const toolName = tool.name || "tool";
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const outcome = await runBeforeToolCallHook({
        toolName,
        params,
        toolCallId,
        ctx,
      });
      if (outcome.blocked) {
        throw new Error(outcome.reason);
      }
      return await execute(toolCallId, outcome.params, signal, onUpdate);
    },
  };
}

export const __testing = {
  runBeforeToolCallHook,
  isPlainObject,
  readExecCommandFromParams,
  isManualLocalWebSearchCommand,
  hasJqHexEscape,
  resolveBuiltinToolBlockReason,
};
