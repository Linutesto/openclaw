# OpenPaw — Assassin Edition

> *Forked from [OpenClaw](https://github.com/openclaw/openclaw). No marketing. No VC bait. No lies.*

---

## What is OpenPaw?

**Local-first agent runtime. Real tools. Real execution. No bullshit.**

OpenPaw is a fork born out of frustration with fake "agentic" systems that pretend to work locally but silently depend on cloud LLMs, API keys, quotas, and smoke & mirrors.

If you're looking for:
- Hype
- Slides
- AGI cosplay
- "OpenAI optional*" (*except when it isn't)

**Close this repo.**

If you want agents that actually execute tools on your machine, keep reading.

---

## What OpenPaw IS

| Feature | Description |
|---------|-------------|
| Local-first runtime | Runs without internet |
| Real tool execution | Not pretend JSON |
| Working sandbox | Actually runs commands |
| Hackable design | Made to be patched, forked, broken, rebuilt |
| For hackers | Not for "users" |

---

## What OpenPaw IS NOT

| Anti-Feature | Why |
|--------------|-----|
| Cloud wrapper | We don't pretend to be autonomous |
| Markdown memory | That's not real persistence |
| AGI roleplay | Agents work, they don't philosophize |
| Demo-optimized | Twitter impressions don't matter |

---

## Core Principles

### 1. Local Means LOCAL

If it doesn't work offline, it's broken.

- Cloud models are **optional**
- Local models are **first-class**

### 2. Tools Actually Execute

When an agent emits a tool call:
1. It **runs**
2. It produces **output**
3. The agent receives the **result**
4. The loop **continues**

No "I would run `ls -la` here".

### 3. Real Security (Not Fake)

OpenPaw does real sandboxing:

```bash
docker run --rm \
  --read-only \
  --cap-drop ALL \
  --network none \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
  debian:bookworm-slim sh -c 'echo sandbox works'
```

Security that breaks execution is not security.

### 4. Hardware Reality Matters

OpenPaw does NOT assume:
- Infinite credits
- A100 GPUs
- 80GB VRAM
- Weekly SaaS budgets

If your setup has limits, OpenPaw **exposes** them instead of hiding them.

---

## Features

| Feature | Status |
|---------|--------|
| Local agent execution | ✅ |
| Automatic tool execution (`--auto-tools`) | ✅ |
| Docker sandbox that works | ✅ |
| Local web search (SearXNG) | ✅ |
| Web discovery (search → fetch → extract) | ✅ |
| Workspace isolation | ✅ |
| Fork-friendly architecture | ✅ |
| Zero cloud required | ✅ |
| QJSON Fractal Memory | ✅ |

---

## Quick Start

```bash
# Build
pnpm install
pnpm build

# Run a local agent
openpaw agent \
  --local \
  --agent main \
  --session-id test \
  --message "List files in the workspace" \
  --auto-tools
```

If the agent can't execute tools on your machine, **that's a bug**.

---

## Configuration (Minimal)

```json
{
  "tools": {
    "web": {
      "searxng": {
        "enabled": true,
        "baseUrl": "http://localhost:8080"
      }
    }
  }
}
```

No magic files. No hidden state. No `.md` pretending to be memory.

---

## Philosophy

OpenPaw assumes:
- You can read logs
- You can debug
- You understand that agents can fail
- You'd rather **know** than be lied to

If your agent is dumb, you'll see it.
If your model is lost, it'll show.
If a tool fails, it errors **loudly**.

This is intentional.

---

## Forking Policy

**Fork it. Break it. Replace the core. Rip out parts you hate.**

If your fork is better than OpenPaw: good.

OpenPaw is not a religion.

---

## Why This Exists

Because "agentic AI" became a buzzword and execution disappeared.

Because "local" started meaning "cloud with a persona".

Because someone had to say:

> **"If it doesn't run, it doesn't count."**

---

## Final Warning

OpenPaw is not polite.
OpenPaw is not safe-marketed.
OpenPaw is not trying to impress anyone.

**OpenPaw exists to work.**

If that offends you, you were never the target audience.

---

## License

MIT License - See [LICENSE](LICENSE)

## Attribution

OpenPaw is a fork of [OpenClaw](https://github.com/openclaw/openclaw).

Original work: Copyright (c) 2025 Peter Steinberger
Fork contributions: Copyright (c) 2026 OpenPaw Contributors

---

**OpenPaw — Agents that actually do things. No bullshit.**
