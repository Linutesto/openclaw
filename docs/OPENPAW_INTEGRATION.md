# OpenPaw: QJSON Agents Integration into OpenPaw

## Executive Summary

OpenPaw is a fork of OpenPaw that integrates key technologies from QJSON Agents to create a more powerful, local-first autonomous agent platform. This document outlines the integration strategy, mapping technologies from both projects.

## Architecture Comparison

### OpenPaw (Base)
- **Language**: TypeScript (ESM)
- **Runtime**: Node.js 22+ / Bun
- **Agent Core**: Pi SDK (pi-agent-core, pi-coding-agent)
- **Gateway**: WebSocket daemon (port 18789)
- **Channels**: 15+ messaging platforms
- **Persistence**: JSONL sessions
- **Tools**: 54 bundled skills

### QJSON Agents (Integration Source)
- **Language**: Python 3.10+
- **Runtime**: Pure Python + Ollama
- **Agent Core**: Custom Agent class with persona manifests
- **Memory**: JSONL + Fractal Memory (FMM) + SQLite RAG
- **Orchestration**: Ring/Mesh/MoE multi-agent topologies
- **Cognition**: QFC/QFCX engines

---

## Integration Mapping

### 1. Persona System (QJSON/YSON → OpenPaw Agents)

**Source**: `qjson_agents/yson.py`, `qjson_agents/qjson_types.py`
**Target**: `src/agents/`, `src/config/`

| QJSON Feature | OpenPaw Equivalent | Integration |
|---------------|---------------------|-------------|
| `agent_id` | `agents.list[].id` | Direct mapping |
| `roles[]` | Agent identity | Add roles array to config |
| `core_directives[]` | System prompt | Inject as bootstrap content |
| `features{}` | Agent settings | Map to feature flags |
| `runtime{}` | Model config | Map to provider/model selection |
| `logic.entrypoints` | Hooks | Map to hook system |

**Implementation**:
```typescript
// src/agents/persona-adapter.ts
interface QjsonPersona {
  agent_id: string;
  origin: string;
  creator: string;
  roles: string[];
  features: Record<string, boolean>;
  core_directives: string[];
  runtime: { model: string; num_predict?: number };
  logic?: { entrypoints: Record<string, string> };
}

function adaptQjsonToOpenPaw(persona: QjsonPersona): AgentConfig {
  return {
    id: persona.agent_id,
    identity: { name: persona.agent_id, roles: persona.roles },
    model: resolveModel(persona.runtime.model),
    systemPromptExtras: persona.core_directives.join('\n'),
    hooks: persona.logic?.entrypoints ?? {},
  };
}
```

### 2. Fractal Memory (FMM → Session Enhancement)

**Source**: `qjson_agents/fmm_store.py`, `qjson_agents/memory.py`
**Target**: `src/agents/pi-embedded-runner/`, `src/sessions/`

**Key Concepts**:
- Hierarchical tree with `__data__` arrays at leaves
- Path-based topic organization (`chat/assistant/summaries`)
- Batched writes with debouncing
- Timestamp-indexed entries

**Integration**:
```typescript
// src/memory/fractal-store.ts
interface FractalNode {
  [key: string]: FractalNode | FractalData;
}

interface FractalData {
  __data__: Array<{
    ts: number;
    text: string;
    topic?: string;
    meta?: Record<string, unknown>;
  }>;
}

class FractalMemoryStore {
  private root: FractalNode = {};
  private dirty = false;
  private debounceTimer?: NodeJS.Timeout;

  insert(path: string[], entry: FractalData['__data__'][0]): void {
    let node = this.root;
    for (const segment of path.slice(0, -1)) {
      node[segment] ??= {};
      node = node[segment] as FractalNode;
    }
    const leaf = path[path.length - 1];
    node[leaf] ??= { __data__: [] };
    (node[leaf] as FractalData).__data__.push(entry);
    this.schedulePersist();
  }

  query(pathPrefix: string[]): FractalData['__data__'] {
    let node = this.root;
    for (const segment of pathPrefix) {
      if (!node[segment]) return [];
      node = node[segment] as FractalNode;
    }
    return this.collectData(node);
  }
}
```

### 3. RAG System (Retrieval → Memory Enhancement)

**Source**: `qjson_agents/retrieval.py`
**Target**: `src/agents/`, `extensions/memory-lancedb/`

**Components**:
- SQLite vector store (no external DB)
- Ollama embeddings with hash fallback
- IVF index for fast candidate selection
- Hybrid scoring: cosine + TF-IDF + freshness

**Integration**:
```typescript
// src/memory/retrieval-store.ts
interface RetrievalConfig {
  topK: number;           // QJSON_RETRIEVAL_TOPK (default: 6)
  decayLambda: number;    // QJSON_RETRIEVAL_DECAY (default: 0.0)
  minScore: number;       // QJSON_RETRIEVAL_MINSCORE (default: 0.25)
  hybridMode?: 'tfidf';   // Optional TF-IDF re-ranking
  freshBoost?: number;    // Recency weight
}

class RetrievalStore {
  private db: Database;
  private embedder: EmbedderBackend;
  private ivfIndex?: IVFIndex;

  async search(query: string, config: RetrievalConfig): Promise<Memory[]> {
    const queryVec = await this.embedder.embed(query);
    let candidates = this.ivfIndex
      ? await this.ivfIndex.probe(queryVec, config.topK * 4)
      : await this.fullScan(queryVec);

    // Apply cosine similarity
    candidates = candidates.map(c => ({
      ...c,
      score: cosineSimilarity(queryVec, c.embedding),
    }));

    // Optional TF-IDF re-ranking
    if (config.hybridMode === 'tfidf') {
      candidates = this.tfidfRerank(query, candidates);
    }

    // Apply freshness boost
    if (config.freshBoost) {
      const now = Date.now();
      candidates = candidates.map(c => ({
        ...c,
        score: c.score + config.freshBoost * Math.exp(-config.decayLambda * (now - c.ts)),
      }));
    }

    return candidates
      .filter(c => c.score >= config.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, config.topK);
  }
}
```

### 4. Multi-Agent Orchestration (Swarm → Agent Collaboration)

**Source**: `qjson_agents/cli.py` (cluster functions)
**Target**: `src/agents/`, new `src/swarm/`

**Topologies**:

| Topology | Description | Use Case |
|----------|-------------|----------|
| **Ring** | Round-robin baton passing | Sequential workflows |
| **Mesh** | Broadcast to all, aggregate replies | Parallel analysis |
| **MoE** | TF-IDF router selects best expert | Specialized tasks |

**Router Scoring (MoE)**:
```
score = Σ[tf_agent[t] * idf[t]] - cooldown_penalty + router_bias - same_prev_penalty
```

**Integration**:
```typescript
// src/swarm/router.ts
interface SwarmConfig {
  topology: 'ring' | 'mesh' | 'moe';
  agents: string[];
  moeConfig?: {
    cooldownPenalty: number;
    routerBias: Record<string, number>;
  };
}

class SwarmRouter {
  selectNext(baton: string, topology: SwarmConfig): string[] {
    switch (topology.topology) {
      case 'ring':
        return [this.nextInRing()];
      case 'mesh':
        return topology.agents;
      case 'moe':
        return this.scoreMoE(baton, topology);
    }
  }

  private scoreMoE(baton: string, config: SwarmConfig): string[] {
    const scores = config.agents.map(agent => ({
      agent,
      score: this.tfidfOverlap(baton, agent)
        - this.getCooldown(agent)
        + (config.moeConfig?.routerBias[agent] ?? 0),
    }));
    return scores.sort((a, b) => b.score - a.score).slice(0, 3).map(s => s.agent);
  }
}
```

### 5. QFC Cognition Engine (Thought Waves → Enhanced Reasoning)

**Source**: `qjson_agents/qfc_engine.py`, `qjson_agents/qfcx_engine.py`
**Target**: `src/agents/cognition/`

**Concepts**:
- CPU-parallel thought waves (default: 3 waves)
- Latent intent vector generation
- Multi-scale noise + tanh nonlinearity
- Optional GPU acceleration (QFCX)

**Integration** (Python subprocess or WASM):
```typescript
// src/agents/cognition/qfc-bridge.ts
interface QFCConfig {
  waves: number;           // QJSON_QFC_WAVES (default: 3)
  threads: number;         // QJSON_QFC_THREADS (auto, max 8)
  useGpu: boolean;         // QJSON_QFCX
  dtype?: 'bf16' | 'fp16'; // GPU precision
}

class QFCBridge {
  private process?: ChildProcess;

  async runCognition(input: string, config: QFCConfig): Promise<CognitionResult> {
    // Spawn Python subprocess for QFC
    const result = await this.callPython('qfc_engine', {
      text: input,
      waves: config.waves,
      threads: config.threads,
    });
    return {
      intentVector: result.latent_intent,
      thoughtGraph: result.thought_graph,
    };
  }
}
```

### 6. Plugin System Alignment

**Source**: `qjson_agents/plugin_manager.py`, `qjson_agents/plugins/`
**Target**: `src/plugins/`, `extensions/`

**Mapping Slash Commands to Skills**:

| QJSON Command | OpenPaw Skill |
|---------------|---------------|
| `/fs_list`, `/fs_read`, `/fs_write` | `read`, `write`, `exec` tools |
| `/py <CODE>` | `exec` with Python |
| `/sql_*` | New `sqlite` skill |
| `/git_*` | Existing Git tools |
| `/api_get`, `/api_post` | `web-fetch` skill |
| `/find`, `/open`, `/crawl` | `browser` + new `crawler` skill |
| `/forge`, `/prism` | New swarm skills |

**Safety Gates Mapping**:

| QJSON Gate | OpenPaw Equivalent |
|------------|-------------------|
| `QJSON_ALLOW_EXEC` | Tool policy allowlist |
| `QJSON_FS_WRITE` | Sandbox write permissions |
| `QJSON_ALLOW_NET` | Network tool policy |
| `QJSON_FS_ROOTS` | Sandbox roots |

### 7. Web Stack (Crawler/Outliner/Indexer)

**Source**: `qjson_agents/web_crawler.py`, `web_outliner.py`, `web_indexer.py`
**Target**: `src/agents/tools/`, `src/browser/`

**Components**:

```typescript
// src/web/outliner.ts
interface DocOutline {
  url: string;
  title: string;
  subtitle?: string;
  sections: Array<{
    level: number;
    title: string;
    text: string;
    anchors?: string[];
  }>;
  dates: Array<{ type: 'published' | 'updated'; value: string }>;
  lang: string;
}

// src/web/crawler.ts
class BFSCrawler {
  private rateLimit: Map<string, number> = new Map();
  private robotsCache: Map<string, RobotsParser> = new Map();

  async crawl(seeds: string[], config: CrawlConfig): Promise<DocOutline[]> {
    const frontier: Array<[string, number]> = seeds.map(s => [s, 0]);
    const visited = new Set<string>();
    const results: DocOutline[] = [];

    while (frontier.length > 0 && results.length < config.maxPages) {
      const [url, depth] = frontier.shift()!;
      if (visited.has(url) || depth > config.maxDepth) continue;
      if (!await this.checkRobots(url)) continue;

      await this.rateLimit(url);
      const html = await this.fetch(url, config.timeout, config.maxBytes);
      const outline = this.outliner.parse(html, url);
      results.push(outline);
      visited.add(url);

      if (depth < config.maxDepth) {
        for (const link of this.extractLinks(html, url)) {
          frontier.push([link, depth + 1]);
        }
      }
    }
    return results;
  }
}
```

---

## Implementation Phases

### Phase 1: Core Integration (Python Bridge)
1. Create Python subprocess bridge for QJSON components
2. Implement persona adapter for YSON manifests
3. Add Fractal Memory store alongside Pi sessions
4. Integrate SQLite RAG with existing memory-lancedb extension

### Phase 2: Native TypeScript Port
1. Port FMM store to TypeScript
2. Port retrieval/RAG to TypeScript with better-sqlite3
3. Port web outliner/crawler to TypeScript
4. Implement swarm router natively

### Phase 3: Cognition & Advanced Features
1. Integrate QFC via Python bridge or port to TypeScript
2. Add MoE routing to multi-agent system
3. Implement full plugin compatibility layer
4. Add YSON config file support

---

## Configuration

### New Environment Variables

```bash
# Memory & RAG
OPENPAW_FMM_ENABLED=1           # Enable Fractal Memory
OPENPAW_RAG_ENABLED=1           # Enable RAG retrieval
OPENPAW_RAG_TOPK=6              # Retrieval top-K
OPENPAW_RAG_MINSCORE=0.25       # Minimum similarity score
OPENPAW_RAG_HYBRID=tfidf        # Hybrid search mode

# Cognition
OPENPAW_QFC_ENABLED=1           # Enable QFC cognition
OPENPAW_QFC_WAVES=3             # Thought waves
OPENPAW_QFCX_ENABLED=1          # GPU acceleration

# Swarm
OPENPAW_SWARM_TOPOLOGY=moe      # ring | mesh | moe
OPENPAW_SWARM_COOLDOWN=0.1      # MoE cooldown penalty

# Web
OPENPAW_CRAWL_RATE=1.0          # Requests per second per host
OPENPAW_CRAWL_DEPTH=2           # Max BFS depth
OPENPAW_CRAWL_PAGES=50          # Max pages per crawl
```

### Config Schema Additions

```json
{
  "agents": {
    "defaults": {
      "memory": {
        "fractal": { "enabled": true },
        "retrieval": {
          "enabled": true,
          "topK": 6,
          "minScore": 0.25,
          "hybridMode": "tfidf"
        }
      },
      "cognition": {
        "qfc": { "enabled": false, "waves": 3 }
      },
      "swarm": {
        "topology": "ring",
        "moe": { "cooldownPenalty": 0.1 }
      }
    }
  }
}
```

---

## File Structure (New/Modified)

```
src/
├── memory/
│   ├── fractal-store.ts          # FMM implementation
│   ├── retrieval-store.ts        # SQLite RAG
│   └── ivf-index.ts              # IVF acceleration
├── swarm/
│   ├── router.ts                 # Swarm routing
│   ├── topologies/
│   │   ├── ring.ts
│   │   ├── mesh.ts
│   │   └── moe.ts
│   └── aggregator.ts             # Reply aggregation
├── cognition/
│   ├── qfc-bridge.ts             # Python bridge
│   └── qfc-native.ts             # Native port (future)
├── web/
│   ├── outliner.ts               # HTML → DocOutline
│   ├── crawler.ts                # BFS crawler
│   └── indexer.ts                # Memory indexer
├── agents/
│   ├── persona-adapter.ts        # QJSON → OpenPaw
│   └── yson-parser.ts            # YSON config support
└── python/
    ├── qfc_bridge.py             # QFC subprocess
    └── requirements.txt          # Python deps
```

---

## Testing Strategy

1. **Unit Tests**: Port QJSON test cases to Vitest
2. **Integration Tests**: Test Python bridge reliability
3. **E2E Tests**: Multi-agent swarm workflows
4. **Performance Tests**: RAG latency, FMM write throughput

---

## Migration Path

For existing OpenPaw users:
1. OpenPaw maintains full backward compatibility
2. QJSON features are opt-in via config/env
3. Existing sessions continue working
4. New features enhance, don't replace

---

## Dependencies

### New NPM Dependencies
- `better-sqlite3` - SQLite for RAG
- `vectorious` or similar - Vector operations

### Python Dependencies (subprocess)
- `numpy` (optional, for QFC)
- Ollama (for embeddings)

---

## Conclusion

OpenPaw combines the best of both worlds:
- OpenPaw's robust gateway, multi-channel messaging, and Pi agent integration
- QJSON's sophisticated memory systems, multi-agent orchestration, and cognition engines

The result is a more powerful, flexible, and intelligent local-first AI assistant platform.
