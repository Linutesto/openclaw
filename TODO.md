# OpenPaw — Development TODO

> *Prioritized task list for OpenPaw development*

---

## Priority 1: Core Agent Runtime

### Auto-Tools Loop (In Progress)
- [x] Add `--auto-tools` CLI flag
- [x] Add `--max-tool-iterations` option
- [ ] Implement tool result injection back into session
- [ ] Loop until no tool calls remain or max iterations
- [ ] Add iteration counter to logs
- [ ] Handle tool execution errors gracefully

### Docker Sandbox
- [x] Remove `no-new-privileges` flag (causes exit 255)
- [x] Basic sandbox config (read-only, cap-drop, tmpfs)
- [ ] Add configurable network policies
- [ ] Add resource limits (CPU, memory)
- [ ] Add execution timeout handling
- [ ] Test on various host configurations

### Container Exec
- [ ] Implement `container.exec()` spawning sandbox
- [ ] Return stdout/stderr properly
- [ ] Handle exit codes
- [ ] Add exec timeout
- [ ] Cleanup containers after execution

---

## Priority 2: Local Web Discovery

### SearXNG Integration
- [x] Create `searxng-search.ts` tool
- [x] Configurable via `tools.web.searxng.baseUrl`
- [x] Environment variable `SEARXNG_URL` support
- [ ] Add result caching
- [ ] Add rate limiting
- [ ] Handle SearXNG errors gracefully

### Web Discover Tool
- [x] Create `web-discover.ts` (search + fetch + extract)
- [ ] Add content extraction improvements
- [ ] Add structured data extraction
- [ ] Add PDF support
- [ ] Add image OCR support (optional)

---

## Priority 3: Memory Systems

### QJSON Integration
- [x] Create `memory-qjson` plugin
- [x] Bridge to QJSON Python retrieval
- [x] Auto-recall hook (inject memories)
- [x] Auto-capture hook (store responses)
- [ ] Add memory deduplication
- [ ] Add memory expiration
- [ ] Add memory importance decay
- [ ] Improve embedding model selection

### Memory Tools
- [x] `memory_recall` - search memories
- [x] `memory_store` - save information
- [x] `memory_stats` - show statistics
- [ ] `memory_forget` - delete specific memories
- [ ] `memory_export` - backup memories
- [ ] `memory_import` - restore memories

---

## Priority 4: NPC Engine Mode

### Entity System
- [ ] NPC registry (load/save JSON/YSON)
- [ ] Entity state management
- [ ] Persistent identity across sessions
- [ ] Goal system with priorities

### Cognitive Loop
- [ ] Event-driven tick mode
- [ ] Time-driven tick mode
- [ ] Hybrid tick mode
- [ ] Perception layer (compress world state)
- [ ] Decision scoring function

### World Integration
- [ ] Event bus (in-process)
- [ ] World state query API
- [ ] Action feedback loop
- [ ] Multi-NPC coordination

### Unity Bridge (Future)
- [ ] Define data contract (events, snapshots, actions)
- [ ] HTTP/WebSocket endpoint
- [ ] Perception compression
- [ ] Action serialization

---

## Priority 5: Security & Workspace Safety

### Workspace Isolation
- [x] Project-scoped workspaces (not $HOME)
- [ ] Configurable workspace roots
- [ ] File access allowlists
- [ ] Dangerous path detection
- [ ] Symlink safety checks

### Tool Safety
- [ ] Tool execution audit logging
- [ ] Rate limiting per tool
- [ ] Dangerous command detection
- [ ] Confirmation prompts for destructive actions

---

## Priority 6: Testing & Quality

### Integration Tests
- [ ] Auto-tools loop test
- [ ] Sandbox execution test
- [ ] Memory plugin test
- [ ] SearXNG integration test
- [ ] End-to-end agent test

### Documentation
- [x] MANIFESTO.md
- [x] README-ASSASSIN.md
- [x] NPC_ENGINE.md
- [ ] API documentation
- [ ] Configuration reference
- [ ] Tool development guide
- [ ] Plugin development guide

---

## Backlog

### Performance
- [ ] Tool execution parallelization
- [ ] Memory retrieval caching
- [ ] LLM response streaming
- [ ] Batch embedding requests

### Developer Experience
- [ ] Better error messages
- [ ] Debug mode with verbose logging
- [ ] Replay mode for debugging
- [ ] Visual tool execution trace

### Integrations
- [ ] Discord bot mode
- [ ] Telegram integration
- [ ] Slack integration
- [ ] Matrix protocol support

---

## Completed

- [x] OpenClaw → OpenPaw rebrand
- [x] Rename 30 plugin manifests
- [x] Fix config validation errors
- [x] Create memory-qjson plugin
- [x] Remove hardcoded paths from plugins
- [x] Add MIT license with attribution
- [x] Create documentation (MANIFESTO, NPC_ENGINE)

---

## Notes

### Environment Variables

```bash
# QJSON Memory
QJSON_AGENTS_HOME=/path/to/qjson_agents
QJSON_PYTHON_PATH=/path/to/python3
QJSON_EMBED_MODEL=nomic-embed-text

# SearXNG
SEARXNG_URL=http://localhost:8080

# Sandbox
OPENPAW_SANDBOX_NETWORK=none
OPENPAW_SANDBOX_TIMEOUT=30000
```

### Useful Commands

```bash
# Run doctor
openpaw doctor --fix

# Start gateway
openpaw gateway

# Test agent
openpaw agent --auto-tools --message "test"

# Check memory stats
openpaw plugin memory-qjson stats
```

---

*Last updated: 2026-02-01*
