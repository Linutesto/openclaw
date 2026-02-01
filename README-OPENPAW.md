# OpenPaw

**OpenPaw** is a fork of [OpenPaw](https://github.com/openpaw/openpaw) that integrates advanced technologies from [QJSON Agents](https://github.com/yan-desbiens/qjson_agents) to create a more powerful, local-first autonomous AI assistant platform.

## Key Features

### From OpenPaw
- **Multi-Channel Messaging**: WhatsApp, Telegram, Slack, Discord, Signal, iMessage, Matrix, Teams, and more
- **WebSocket Gateway**: Long-lived daemon managing all messaging surfaces
- **Pi Agent Integration**: Embedded pi-coding-agent for autonomous operation
- **54 Bundled Skills**: 1Password, GitHub, Slack, Discord, weather, voice, and more
- **Native Apps**: macOS, iOS, Android
- **Web UI & Canvas**: A2UI-powered interactive rendering

### From QJSON Agents (New!)
- **Fractal Memory (FMM)**: Hierarchical tree structure for organized, persistent memory
- **RAG Retrieval**: SQLite + embeddings with IVF acceleration for semantic search
- **QFC Cognition Engine**: CPU-parallel thought waves for enhanced reasoning
- **Multi-Agent Swarm**: Ring, Mesh, and Mixture-of-Experts topologies
- **YSON Persona Format**: Human-friendly agent configuration

## Quick Start

```bash
# Install
npm install -g openpaw

# Or use npx
npx openpaw

# Run the gateway
openpaw gateway

# Start chatting
openpaw agent --message "Hello, OpenPaw!"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpenPaw                                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │   Gateway     │  │  Pi Agent     │  │  QJSON Bridge │       │
│  │  (WebSocket)  │  │   (Core)      │  │   (Python)    │       │
│  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘       │
│          │                  │                  │                │
│  ┌───────┴───────────────────┴──────────────────┴───────┐      │
│  │                    Tool Layer                         │      │
│  │  read | write | exec | browser | send | memory | ...  │      │
│  └───────┬───────────────────┬──────────────────┬───────┘      │
│          │                   │                  │               │
│  ┌───────┴───────┐  ┌────────┴────────┐  ┌─────┴──────┐       │
│  │   Channels    │  │  Memory Layer   │  │   Swarm    │       │
│  │ WA|TG|Slack.. │  │  FMM | RAG | QFC│  │ Ring|MoE.. │       │
│  └───────────────┘  └─────────────────┘  └────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

## Configuration

### Enable QJSON Features

Add to `~/.openpaw/openpaw.json`:

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
        "topology": "ring"
      }
    }
  }
}
```

### Environment Variables

```bash
# Memory & RAG
export OPENPAW_FMM_ENABLED=1
export OPENPAW_RAG_ENABLED=1
export OPENPAW_RAG_TOPK=6

# Cognition
export OPENPAW_QFC_ENABLED=1
export OPENPAW_QFC_WAVES=3

# Swarm
export OPENPAW_SWARM_TOPOLOGY=moe
```

## New Tools

### Memory Tools

```typescript
// Store in Fractal Memory
await memory_store({
  path: ["research", "ai", "agents"],
  content: "Summary of multi-agent architectures...",
  topic: "swarm-patterns"
});

// Retrieve with RAG
await memory_retrieve({
  query: "agent collaboration patterns",
  top_k: 6,
  min_score: 0.25
});
```

### Swarm Tools

```typescript
// Create a multi-agent swarm
await swarm_create({
  agents: ["researcher", "analyst", "writer"],
  topology: "moe",  // ring | mesh | moe
  goal: "Research and write about AI agents"
});

// Run the swarm
await swarm_run({
  swarm_id: "research-team",
  baton: "Investigate recent advances in agent memory systems",
  max_rounds: 5
});
```

### Web Crawler Tools

```typescript
// Crawl and index
await web_crawl({
  seeds: ["https://example.com"],
  max_depth: 2,
  max_pages: 50,
  index: true  // Store in memory
});
```

## Python Bridge

OpenPaw includes a Python bridge for QJSON integration:

```bash
# Install Python dependencies
pip install -r python/requirements.txt

# The bridge is automatically used when QJSON features are enabled
```

## Documentation

- [Integration Guide](docs/OPENPAW_INTEGRATION.md) - Full integration details
- [Agent Daemon Tools](docs/AGENT_DAEMON_TOOLS.md) - Complete tool reference
- [OpenPaw Docs](https://docs.openpaw.ai) - Base platform documentation

## Directory Structure

```
openpaw/
├── src/                    # TypeScript source
├── python/                 # Python bridge for QJSON
│   ├── qjson_bridge.py    # Main bridge module
│   └── requirements.txt   # Python dependencies
├── docs/
│   ├── OPENPAW_INTEGRATION.md
│   └── AGENT_DAEMON_TOOLS.md
├── scripts/
│   ├── auth_monitor.py    # Python auth monitor
│   └── openpaw_log.py     # Cross-platform log viewer
├── extensions/            # Channel plugins
├── skills/                # Bundled skills
└── apps/                  # Native apps (macOS, iOS, Android)
```

## Comparison: OpenPaw vs OpenPaw vs QJSON Agents

| Feature | OpenPaw | QJSON Agents | OpenPaw |
|---------|----------|--------------|---------|
| Language | TypeScript | Python | TypeScript + Python |
| Runtime | Node.js | Python + Ollama | Node.js + Python |
| Channels | 15+ | None | 15+ |
| Memory | JSONL | FMM + JSONL + RAG | All combined |
| Multi-Agent | Basic | Ring/Mesh/MoE | Full integration |
| Cognition | None | QFC/QFCX | QFC via bridge |
| Native Apps | macOS/iOS/Android | None | macOS/iOS/Android |
| Web UI | Yes | Text menu | Yes |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

# Dev mode
pnpm dev
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

- **OpenPaw**: Base platform providing the gateway, channels, and agent infrastructure
- **QJSON Agents**: Memory systems, RAG, swarm orchestration, and cognition engine
- **Pi SDK**: Underlying agent loop and tool execution
