/**
 * OpenPaw Memory (QJSON) Plugin
 *
 * Integrates QJSON Agents' Fractal Memory system for long-term memory.
 * - SQLite + embeddings with IVF acceleration
 * - Local-first with Ollama embeddings
 * - Time-decay and relevance scoring
 * - Fractal hierarchical memory paths
 */

import type { OpenPawPluginApi } from "openpaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

type QjsonConfig = {
  qjsonPath?: string;
  pythonPath?: string;
  embeddingModel?: string;
  topK?: number;
  autoCapture?: boolean;
  autoRecall?: boolean;
};

type MemoryEntry = {
  id: string;
  text: string;
  importance: number;
  category: string;
  createdAt: number;
  score?: number;
};

// ============================================================================
// Python Bridge
// ============================================================================

class QjsonBridge {
  private pythonPath: string;
  private qjsonPath: string;
  private embeddingModel: string;
  private topK: number;

  constructor(config: QjsonConfig) {
    // Use config values, env vars, or sensible defaults
    this.pythonPath = config.pythonPath || process.env.QJSON_PYTHON_PATH || "python3";
    this.qjsonPath = config.qjsonPath || process.env.QJSON_AGENTS_HOME || "";
    this.embeddingModel = config.embeddingModel || process.env.QJSON_EMBED_MODEL || "nomic-embed-text";
    this.topK = config.topK || 8;
  }

  private async runPython(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.pythonPath, ["-c", code], {
        env: {
          ...process.env,
          PYTHONPATH: this.qjsonPath,
          QJSON_EMBED_MODEL: this.embeddingModel,
        },
        cwd: this.qjsonPath,
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`Python error (${code}): ${stderr}`));
        }
      });

      proc.on("error", reject);
    });
  }

  async store(text: string, importance: number = 0.5, category: string = "conversation"): Promise<MemoryEntry> {
    const id = randomUUID();
    const escapedText = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const code = `
import sys
sys.path.insert(0, "${this.qjsonPath}")
from qjson_agents.retrieval import add_memory
result = add_memory("${escapedText}", importance=${importance})
print(result if result else "${id}")
`;
    try {
      await this.runPython(code);
      return {
        id,
        text,
        importance,
        category,
        createdAt: Date.now(),
      };
    } catch (err) {
      console.error("[memory-qjson] store error:", err);
      return {
        id,
        text,
        importance,
        category,
        createdAt: Date.now(),
      };
    }
  }

  async search(query: string, topK?: number): Promise<MemoryEntry[]> {
    const k = topK || this.topK;
    const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const code = `
import sys
import json
sys.path.insert(0, "${this.qjsonPath}")
from qjson_agents.retrieval import search_memory
results = search_memory("${escapedQuery}", top_k=${k})
out = []
for text, score in results:
    out.append({"text": text, "score": float(score)})
print(json.dumps(out))
`;
    try {
      const result = await this.runPython(code);
      const parsed = JSON.parse(result || "[]");
      return parsed.map((r: { text: string; score: number }, i: number) => ({
        id: `search-${i}`,
        text: r.text,
        importance: r.score,
        category: "retrieved",
        createdAt: Date.now(),
        score: r.score,
      }));
    } catch (err) {
      console.error("[memory-qjson] search error:", err);
      return [];
    }
  }

  async injectForPrompt(query: string): Promise<string> {
    const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const code = `
import sys
sys.path.insert(0, "${this.qjsonPath}")
from qjson_agents.retrieval import inject_for_prompt
result = inject_for_prompt("${escapedQuery}", top_k=${this.topK})
print(result)
`;
    try {
      return await this.runPython(code);
    } catch (err) {
      console.error("[memory-qjson] inject error:", err);
      return "";
    }
  }

  async getStats(): Promise<{ count: number; dbPath: string }> {
    const code = `
import sys
import json
sys.path.insert(0, "${this.qjsonPath}")
from qjson_agents.retrieval import DB_PATH, _ensure_db
import sqlite3
_ensure_db()
con = sqlite3.connect(DB_PATH)
count = con.execute("SELECT COUNT(*) FROM memories").fetchone()[0]
con.close()
print(json.dumps({"count": count, "dbPath": DB_PATH}))
`;
    try {
      const result = await this.runPython(code);
      return JSON.parse(result);
    } catch (err) {
      console.error("[memory-qjson] stats error:", err);
      return { count: 0, dbPath: "unknown" };
    }
  }
}

// ============================================================================
// Plugin Export
// ============================================================================

export default function plugin(api: OpenPawPluginApi) {
  const config = (api.config || {}) as QjsonConfig;
  const bridge = new QjsonBridge(config);

  api.logger.info("memory-qjson: QJSON Fractal Memory plugin loading...");

  // Register memory tools
  api.registerTool(
    {
      name: "memory_recall",
      label: "Memory Recall (QJSON)",
      description:
        "Search through long-term fractal memories. Use when you need context about user preferences, past decisions, or previously discussed topics.",
      parameters: Type.Object({
        query: Type.String({ description: "Search query" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default: 8)" })),
      }),
      async execute(_toolCallId, params) {
        const { query, limit = 8 } = params as { query: string; limit?: number };
        const results = await bridge.search(query, limit);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: "No relevant memories found." }],
            details: { count: 0 },
          };
        }

        const text = results
          .map(
            (r, i) =>
              `${i + 1}. ${r.text} (${((r.score || 0) * 100).toFixed(0)}% relevance)`,
          )
          .join("\n");

        return {
          content: [{ type: "text", text: `Found ${results.length} memories:\n\n${text}` }],
          details: { count: results.length, memories: results },
        };
      },
    },
    { name: "memory_recall" },
  );

  api.registerTool(
    {
      name: "memory_store",
      label: "Memory Store (QJSON)",
      description:
        "Save important information in long-term fractal memory. Use for preferences, facts, decisions.",
      parameters: Type.Object({
        text: Type.String({ description: "Information to remember" }),
        importance: Type.Optional(Type.Number({ description: "Importance 0-1 (default: 0.5)" })),
        category: Type.Optional(Type.String({ description: "Category: fact, preference, context, task, other" })),
      }),
      async execute(_toolCallId, params) {
        const {
          text,
          importance = 0.5,
          category = "other",
        } = params as {
          text: string;
          importance?: number;
          category?: string;
        };

        const entry = await bridge.store(text, importance, category);

        return {
          content: [{ type: "text", text: `Stored in fractal memory: "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"` }],
          details: { action: "created", id: entry.id },
        };
      },
    },
    { name: "memory_store" },
  );

  api.registerTool(
    {
      name: "memory_stats",
      label: "Memory Stats (QJSON)",
      description: "Get statistics about the QJSON fractal memory store",
      parameters: Type.Object({}),
      async execute() {
        const stats = await bridge.getStats();
        return {
          content: [{ type: "text", text: `Memory store: ${stats.count} entries\nDatabase: ${stats.dbPath}` }],
          details: stats,
        };
      },
    },
    { name: "memory_stats" },
  );

  // Auto-recall hook: inject memories before LLM call
  if (config.autoRecall !== false) {
    api.on("beforeInference", async (ctx) => {
      try {
        const lastUserMsg = ctx.messages
          .filter((m: { role: string }) => m.role === "user")
          .pop();
        if (lastUserMsg && typeof lastUserMsg.content === "string") {
          const memories = await bridge.injectForPrompt(lastUserMsg.content);
          if (memories && memories.trim()) {
            ctx.systemPromptExtra = (ctx.systemPromptExtra || "") +
              "\n\n<recalled_memories>\n" + memories + "\n</recalled_memories>";
            api.logger.info?.(`memory-qjson: injected memories into context`);
          }
        }
      } catch (err) {
        api.logger.warn?.(`memory-qjson: recall failed: ${String(err)}`);
      }
    });
  }

  // Auto-capture hook: store important assistant responses
  if (config.autoCapture) {
    api.on("afterInference", async (ctx) => {
      try {
        const lastAssistant = ctx.messages
          .filter((m: { role: string }) => m.role === "assistant")
          .pop();
        if (lastAssistant && typeof lastAssistant.content === "string") {
          const content = lastAssistant.content;
          // Simple heuristic: capture if message contains key phrases
          const shouldCapture =
            content.toLowerCase().includes("remember") ||
            content.toLowerCase().includes("important") ||
            content.toLowerCase().includes("note that") ||
            content.length > 500;
          if (shouldCapture) {
            await bridge.store(content.slice(0, 1000), 0.6, "conversation");
            api.logger.info?.("memory-qjson: auto-captured response");
          }
        }
      } catch (err) {
        api.logger.warn?.(`memory-qjson: capture failed: ${String(err)}`);
      }
    });
  }

  // Log stats on load (async, fire-and-forget)
  bridge.getStats().then((stats) => {
    api.logger.info(`memory-qjson: Memory store has ${stats.count} entries at ${stats.dbPath}`);
  }).catch(() => {
    api.logger.info("memory-qjson: Could not get memory stats (QJSON may not be initialized)");
  });
}
