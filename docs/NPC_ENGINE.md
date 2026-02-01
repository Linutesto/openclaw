# OpenPaw — NPC Engine Mode

> *Transform agents into persistent entities that live in a world.*

**NPC Engine Mode** uses OpenPaw not as an assistant, but as the living brain of persistent entities in a world (game, simulation, RP, sandbox, etc.).

Here, an agent doesn't wait for you to talk to it.
**It exists, reacts, acts, remembers.**

---

## Table of Contents

- [Goals](#goals)
- [Non-Goals](#non-goals)
- [Core Concepts](#core-concepts)
- [Runtime Architecture](#runtime-architecture)
- [Memory System](#memory-system)
- [Decision & Planning](#decision--planning)
- [Safety & Constraints](#safety--constraints)
- [Unity Integration](#unity-integration)
- [Debugging & Telemetry](#debugging--telemetry)
- [Implementation Checklist](#implementation-checklist)

---

## Goals

- **Persistent NPCs** (identity + state + memory) across sessions
- **World-driven NPCs** (events, time, perception), not just user-driven
- **NPCs that use tools** as concrete actions (move, talk, inspect, attack, craft, query world)
- **Local-first runtime**, sandboxed, modifiable, forkable

---

## Non-Goals

- Decorative memory in `.md` files ("I feel nostalgic today" — no)
- Personality reset on every prompt
- Cloud-only "it works because the API does everything"
- Rigid scripted NPCs that just replay dialogue loops

---

## Core Concepts

### 1. Entity Model (NPC = process + state)

Each NPC is an entity with:

| Field | Description |
|-------|-------------|
| `id` | Stable unique identifier |
| `persona` | Role, voice, boundaries |
| `state` | Mood, health, stamina, location |
| `goals` | Dynamic priorities |
| `relationships` | Trust, fear, debt, alliance maps |
| `memory` | Actionable facts |

**Example:**
```json
{
  "id": "guard_17",
  "role": "city_guard",
  "location": "north_gate",
  "mood": "tired",
  "goals": ["protect_gate", "finish_shift", "avoid_trouble"],
  "relationships": {
    "player_12": { "trust": -0.3, "threat": 0.6 }
  }
}
```

### 2. Cognitive Loop

The core loop:

```
observe → think → decide → act → update_state
```

**Tick Modes:**

| Mode | Description |
|------|-------------|
| Event-driven | Tick when an event arrives (player enters, alarm, etc.) |
| Time-driven | Tick every X ms/seconds (patrol, hunger, fatigue) |
| Hybrid | Event + heartbeat combined |

### 3. World Events

NPCs receive events from the world:

- `PlayerEnteredZone`
- `HeardNoise`
- `AlarmTriggered`
- `NightFell`
- `NPCInjured`
- `ItemStolen`
- `FactionReputationChanged`

**Event Schema:**
```json
{
  "type": "PlayerEnteredZone",
  "ts": 1738430000,
  "zone": "north_gate",
  "entity": { "id": "player_12" },
  "meta": { "speed": 2.1, "weapon": "knife" }
}
```

### 4. Tools as Actions

Tools are **world actions**, not gadgets:

| Tool | Description |
|------|-------------|
| `move_to(location)` | Navigate to location |
| `say_to(target, text)` | Speak to entity |
| `inspect(target)` | Examine entity/object |
| `pickup(item)` | Acquire item |
| `attack(target)` | Initiate combat |
| `query_world(dsl)` | Query world state |
| `set_flag(key, value)` | Set world flag |
| `emit_event(event)` | Trigger world event |

**Tool Result:**
```json
{
  "ok": true,
  "result": {
    "newLocation": "market_square",
    "seen": ["thief_3", "vendor_2"]
  }
}
```

---

## Runtime Architecture

### Components

```
World Engine
   ├── Event Bus
   ├── Time System
   ├── Physics / Rules
   │
OpenPaw NPC Engine
   ├── NPC Registry
   ├── Cognitive Loop Scheduler
   ├── Perception Layer
   ├── Memory Layer
   ├── Tool Dispatcher
   └── Sandbox Executor
```

### Data Flow

1. **World** → Event Bus
2. **Event Bus** → NPC (routing by zone/perception)
3. **NPC** → decides tool calls
4. **Tool Dispatcher** → executes → returns results
5. **NPC** → updates state/memory → optionally emits new events

---

## Memory System

### Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| **Episodic** | What happened | "thief_3 escaped at north_gate" |
| **Semantic** | Known facts | "thief_3 = known pickpocket, threat medium" |
| **Procedural** | Routines | "patrol morning", "rest afternoon" |
| **Relational** | Trust/threat tables | `{ "player_12": { trust: -0.3 } }` |

### Storage

- **Minimum viable:** SQLite with tables `npc_state`, `npc_memory`, `npc_relations`
- **Enhanced:** Embeddings (RAG) for semantic retrieval on useful notes

### Hard Rule

> Memory must serve decisions. If it doesn't help decide something, it gets deleted.

---

## Decision & Planning

### Default Policy

1. 1-3 reflection steps max
2. Choose one action
3. Execute
4. Re-evaluate

**Avoid** the "plan 50 steps and never act" pattern.

### Priority Scoring

Each NPC has a scoring function weighing:

- Danger
- Opportunity
- Fatigue
- Mission
- Curiosity
- Social pressure

The highest-value action wins.

---

## Safety & Constraints

| Constraint | Implementation |
|------------|----------------|
| Sandboxed execution | read-only root, cap-drop ALL, network rules |
| Rate limiting | Max destructive actions per tick |
| Iteration limits | Max tool iterations per tick |
| Hard timeouts | Execution timeout per action |
| Audit logging | Journal every action |

---

## Unity Integration

**Goal:** OpenPaw = external brain (local); Unity = world + rendering + physics.

### Option A: Unity as Server (Recommended)

Unity exposes a local endpoint:
- HTTP (UnityWebRequest + embedded server)
- WebSocket
- Named Pipes (Windows) / Unix socket (Linux)

OpenPaw sends tool calls → Unity executes → returns results.

**Pros:** Unity keeps world authority, natural anti-cheat.
**Cons:** Requires clean API layer.

### Option B: OpenPaw as Server

OpenPaw offers a WebSocket endpoint.
Unity pushes events (player movement, collisions).
OpenPaw returns NPC actions.

**Pros:** Simple to prototype.
**Cons:** Desync risk if poorly managed.

### Data Contract

**Unity → OpenPaw:**
```json
{
  "events": [...],
  "snapshot": {
    "nearby_entities": [...],
    "zone": "north_gate",
    "time": 14.5
  },
  "nav_graph": { ... }
}
```

**OpenPaw → Unity:**
```json
{
  "actions": [
    { "tool": "move_to", "args": { "location": "market" } },
    { "tool": "say_to", "args": { "target": "player_12", "text": "Halt!" } }
  ],
  "state_updates": { ... }
}
```

### Perception Compression

**Don't send the entire world to the LLM.** Send:
- What the NPC can perceive
- In a stable format
- Max N nearby entities
- Useful facts (distance, threat, faction)

---

## Debugging & Telemetry

| Feature | Description |
|---------|-------------|
| Per-NPC logs | `npc_id`, `tick_id`, event, decision, tools, result |
| Replay mode | Replay a tick with same events/snapshots |
| Dumb mode | Bypass LLM, script actions (test tool pipeline) |

---

## Implementation Checklist

### MVP

- [ ] NPC registry (load/save JSON/YSON)
- [ ] Event bus (in-process)
- [ ] Scheduler (time ticks + event ticks)
- [ ] Tool dispatcher (move/say/inspect minimal)
- [ ] Memory store (SQLite)
- [ ] 3 base NPCs (guard, vendor, thief)
- [ ] World state mock (zone graph + entities list)

### Extended

- [ ] Multi-agent topologies (ring/mesh/MoE)
- [ ] Factions + global reputation
- [ ] Emergent economy (inventory + trades)
- [ ] Emotion constraints (behavior, not drama)
- [ ] Combat heuristics + post-combat memory
- [ ] Long-term goals + story arcs

---

## Use Cases

- Dynamic NPCs in single-player games
- Social simulations
- Living cities
- Learning enemies
- Persistent RP worlds
- Experimental/research worlds

---

## Philosophy

> An NPC is not a chatbot. It's an autonomous process with constraints.

If your NPC can:
- Make mistakes
- Panic
- Improvise
- Survive without you

**You're on the right track.**

---

## License

MIT License - See [LICENSE](../LICENSE)

## Attribution

OpenPaw NPC Engine is part of [OpenPaw](https://github.com/Linutesto/openclaw), forked from [OpenClaw](https://github.com/openclaw/openclaw).
