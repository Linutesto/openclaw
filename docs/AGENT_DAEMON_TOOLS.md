# OpenPaw Agent Daemon Tools Reference

## Overview

The OpenPaw agent daemon provides a comprehensive set of tools for autonomous operation. This document covers all available tools, their configuration, and effective usage patterns.

## Core Tool Categories

### 1. File System Tools

#### read
Read file contents from the workspace.

```typescript
{
  name: "read",
  parameters: {
    file_path: string,      // Absolute path to file
    offset?: number,        // Line offset (1-indexed)
    limit?: number          // Max lines to read
  }
}
```

**Usage Tips**:
- Always read files before editing
- Use offset/limit for large files
- Supports images (PNG, JPG), PDFs, Jupyter notebooks

#### write
Create or overwrite files.

```typescript
{
  name: "write",
  parameters: {
    file_path: string,      // Absolute path
    content: string         // File content
  }
}
```

**Guardrails**:
- Requires prior read of existing files
- Respects sandbox boundaries
- No automatic directory creation

#### edit
Perform precise text replacements.

```typescript
{
  name: "edit",
  parameters: {
    file_path: string,
    old_string: string,     // Exact text to replace
    new_string: string,     // Replacement text
    replace_all?: boolean   // Replace all occurrences
  }
}
```

**Best Practices**:
- Include sufficient context in old_string for uniqueness
- Preserve original indentation exactly
- Use replace_all for variable renaming

### 2. Execution Tools

#### exec
Execute shell commands with PTY support.

```typescript
{
  name: "exec",
  parameters: {
    command: string,        // Shell command
    timeout?: number,       // Milliseconds (max 600000)
    cwd?: string           // Working directory
  }
}
```

**Safety**:
- Commands run in a sandboxed environment
- Timeout prevents runaway processes
- Output truncated at 30KB

#### bash
Alias for exec with bash shell semantics.

```typescript
{
  name: "bash",
  parameters: {
    command: string,
    description?: string,   // For logging
    run_in_background?: boolean
  }
}
```

### 3. Browser Tools

#### browser
Web automation via Playwright.

```typescript
{
  name: "browser",
  parameters: {
    action: "navigate" | "click" | "type" | "screenshot" | "extract",
    url?: string,
    selector?: string,
    text?: string
  }
}
```

**Capabilities**:
- Navigate to URLs
- Click elements
- Type text
- Take screenshots
- Extract content

### 4. Messaging Tools

#### send
Send messages via connected channels.

```typescript
{
  name: "send",
  parameters: {
    channel: "whatsapp" | "telegram" | "slack" | "discord" | "signal" | "imessage",
    to: string,             // Recipient identifier
    message: string,
    media_url?: string      // Optional attachment
  }
}
```

### 5. Memory Tools (OpenPaw Enhanced)

#### memory_store
Store information in Fractal Memory.

```typescript
{
  name: "memory_store",
  parameters: {
    path: string[],         // Hierarchical path
    content: string,
    topic?: string,
    meta?: Record<string, unknown>
  }
}
```

**Example**:
```typescript
await memory_store({
  path: ["research", "ai", "agents"],
  content: "Summary of multi-agent architectures...",
  topic: "swarm-patterns"
});
```

#### memory_retrieve
Query memories using RAG.

```typescript
{
  name: "memory_retrieve",
  parameters: {
    query: string,
    top_k?: number,         // Default: 6
    min_score?: number,     // Default: 0.25
    path_prefix?: string[]  // Filter by path
  }
}
```

### 6. Canvas Tools

#### canvas
Render interactive UI via A2UI.

```typescript
{
  name: "canvas",
  parameters: {
    action: "create" | "update" | "clear",
    html?: string,
    data?: Record<string, unknown>
  }
}
```

### 7. Session Tools

#### session
Manage agent sessions.

```typescript
{
  name: "session",
  parameters: {
    action: "list" | "switch" | "branch" | "compact",
    session_id?: string
  }
}
```

### 8. Cron Tools

#### cron
Schedule recurring tasks.

```typescript
{
  name: "cron",
  parameters: {
    action: "list" | "add" | "remove" | "pause" | "resume",
    schedule?: string,      // Cron expression
    command?: string,
    job_id?: string
  }
}
```

---

## OpenPaw Extended Tools

### 9. Web Crawler Tools

#### web_crawl
BFS web crawler with indexing.

```typescript
{
  name: "web_crawl",
  parameters: {
    seeds: string[],        // Starting URLs
    max_depth?: number,     // Default: 2
    max_pages?: number,     // Default: 50
    rate_limit?: number,    // Requests/sec/host
    index?: boolean         // Store in memory
  }
}
```

**Features**:
- Respects robots.txt
- Per-host rate limiting
- Automatic content hashing for dedup
- DocOutline extraction

#### web_outline
Parse HTML to structured outline.

```typescript
{
  name: "web_outline",
  parameters: {
    url?: string,           // Fetch and parse
    html?: string           // Parse provided HTML
  }
}
```

**Returns**:
```typescript
{
  title: string,
  subtitle?: string,
  sections: Array<{
    level: number,
    title: string,
    text: string
  }>,
  dates: Array<{ type: string, value: string }>,
  lang: string
}
```

### 10. Swarm Tools

#### swarm_create
Create a multi-agent swarm.

```typescript
{
  name: "swarm_create",
  parameters: {
    agents: string[],       // Agent IDs
    topology: "ring" | "mesh" | "moe",
    goal: string,
    moe_config?: {
      cooldown_penalty: number,
      router_bias: Record<string, number>
    }
  }
}
```

#### swarm_run
Execute a swarm task.

```typescript
{
  name: "swarm_run",
  parameters: {
    swarm_id: string,
    baton: string,          // Initial message
    max_rounds?: number
  }
}
```

### 11. Cognition Tools

#### qfc_analyze
Run QFC cognition on input.

```typescript
{
  name: "qfc_analyze",
  parameters: {
    text: string,
    waves?: number,         // Default: 3
    return_graph?: boolean  // Include thought graph
  }
}
```

**Returns**:
```typescript
{
  intent_vector: number[],
  thought_graph?: {
    nodes: Array<{ id: string, content: string }>,
    edges: Array<{ from: string, to: string, weight: number }>
  }
}
```

---

## Tool Policies

### Allowlist/Denylist

Configure which tools are available per agent:

```json
{
  "agents": {
    "list": [{
      "id": "research-agent",
      "tools": {
        "allow": ["read", "web_crawl", "memory_*"],
        "deny": ["exec", "write"]
      }
    }]
  }
}
```

### Sandbox Restrictions

Tools respect sandbox boundaries:

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "enabled": true,
        "roots": ["/home/user/workspace"],
        "writableRoots": ["/home/user/workspace/output"]
      }
    }
  }
}
```

---

## Effective Tool Usage Patterns

### 1. Research Workflow

```
1. web_crawl → Gather information
2. memory_store → Index findings
3. memory_retrieve → Query for synthesis
4. write → Generate report
```

### 2. Code Development Workflow

```
1. read → Understand existing code
2. memory_retrieve → Find similar patterns
3. edit → Make changes
4. exec → Run tests
5. browser → Verify in browser
```

### 3. Multi-Agent Collaboration

```
1. swarm_create → Setup ring topology
2. swarm_run → Pass research baton
3. memory_retrieve → Aggregate findings
4. qfc_analyze → Synthesize insights
```

### 4. Autonomous Monitoring

```
1. cron → Schedule periodic checks
2. web_crawl → Monitor URLs
3. memory_store → Track changes
4. send → Alert on significant changes
```

---

## Error Handling

### Common Error Codes

| Code | Meaning | Resolution |
|------|---------|------------|
| `SANDBOX_VIOLATION` | Path outside allowed roots | Use paths within sandbox |
| `TOOL_TIMEOUT` | Execution exceeded timeout | Increase timeout or simplify command |
| `RATE_LIMITED` | Too many requests | Reduce request frequency |
| `AUTH_REQUIRED` | Missing credentials | Configure auth profile |
| `FILE_NOT_FOUND` | Path doesn't exist | Verify path before access |

### Retry Strategies

```typescript
// Automatic retry with backoff
{
  "tools": {
    "retry": {
      "maxAttempts": 3,
      "backoffMs": [1000, 2000, 4000]
    }
  }
}
```

---

## Performance Optimization

### Parallel Tool Calls

When tools are independent, call them in parallel:

```typescript
// Good: Parallel reads
await Promise.all([
  read({ file_path: "/path/to/file1.ts" }),
  read({ file_path: "/path/to/file2.ts" }),
]);

// Bad: Sequential when not needed
await read({ file_path: "/path/to/file1.ts" });
await read({ file_path: "/path/to/file2.ts" });
```

### Memory-Efficient Patterns

```typescript
// Use offset/limit for large files
await read({
  file_path: "/path/to/large.log",
  offset: 1000,
  limit: 100
});

// Use path_prefix for targeted retrieval
await memory_retrieve({
  query: "agent patterns",
  path_prefix: ["research", "ai"]
});
```

---

## Monitoring & Debugging

### Tool Execution Logs

Enable verbose logging:

```bash
OPENPAW_TOOL_VERBOSE=1 openpaw gateway
```

### Metrics

Access via gateway API:

```bash
curl http://localhost:18789/metrics/tools
```

Returns:
```json
{
  "read": { "calls": 150, "avgMs": 12 },
  "exec": { "calls": 45, "avgMs": 850 },
  "memory_retrieve": { "calls": 30, "avgMs": 45 }
}
```

---

## Security Considerations

1. **Principle of Least Privilege**: Only enable tools an agent needs
2. **Sandbox Everything**: Always run with sandbox enabled
3. **Audit Logs**: Review tool usage in session logs
4. **Rate Limits**: Prevent resource exhaustion
5. **Secret Management**: Never pass secrets as tool parameters

---

## Version History

- **v1.0.0**: Initial OpenPaw tools release
- **v1.1.0**: Added Fractal Memory tools
- **v1.2.0**: Added Swarm and QFC tools
- **v1.3.0**: Added Web Crawler tools
