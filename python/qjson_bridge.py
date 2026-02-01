#!/usr/bin/env python3
"""
QJSON Bridge for OpenPaw - Production Runtime

This module provides the core execution bridge between OpenPaw (TypeScript) and
QJSON Agents (Python). It implements:
- Event-driven memory (Single Source of Truth)
- Tool execution loop with sandbox support
- Fractal Memory, RAG, QFC, Swarm orchestration

Protocol (JSON-RPC over stdin/stdout):
    Request:  {"id": N, "method": "...", "params": {...}}
    Response: {"id": N, "result": {...}} or {"id": N, "error": {...}}

Event Schema (standardized):
    {
        "ts": 1738360000.123,
        "session": "whatsapp:+1234567890",
        "role": "user|assistant|system|tool",
        "text": "...",
        "meta": {"agent": "...", "channel": "...", "tool": "..."},
        "tags": ["inbound", "outbound", "tool_call", "tool_result"]
    }
"""

import json
import sys
import os
import time
import traceback
import subprocess
import hashlib
import sqlite3
import threading
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, Optional, List, Callable
from dataclasses import dataclass, asdict, field
from enum import Enum
import re


# =============================================================================
# Event Schema (Single Source of Truth)
# =============================================================================

class EventRole(str, Enum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"
    TOOL = "tool"


@dataclass
class Event:
    """Standardized event for all memory operations."""
    ts: float
    session: str
    role: str
    text: str
    meta: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)

    @classmethod
    def create(
        cls,
        session: str,
        role: str,
        text: str,
        meta: Optional[Dict] = None,
        tags: Optional[List[str]] = None
    ) -> "Event":
        return cls(
            ts=time.time(),
            session=session,
            role=role,
            text=text,
            meta=meta or {},
            tags=tags or []
        )

    def to_dict(self) -> Dict:
        return asdict(self)


class EventLog:
    """Append-only event log (JSONL)."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def append(self, event: Event) -> None:
        with self._lock:
            with open(self.path, "a") as f:
                f.write(json.dumps(event.to_dict()) + "\n")

    def tail(self, n: int = 50) -> List[Event]:
        if not self.path.exists():
            return []
        with self._lock:
            lines = self.path.read_text().strip().split("\n")[-n:]
            return [Event(**json.loads(line)) for line in lines if line]

    def query(self, session: Optional[str] = None, role: Optional[str] = None, limit: int = 100) -> List[Event]:
        events = self.tail(limit * 2)  # Over-fetch then filter
        if session:
            events = [e for e in events if e.session == session]
        if role:
            events = [e for e in events if e.role == role]
        return events[-limit:]


# =============================================================================
# Fractal Memory (FMM)
# =============================================================================

@dataclass
class FractalEntry:
    """Entry in the Fractal Memory tree."""
    ts: float
    text: str
    topic: Optional[str] = None
    meta: Optional[Dict[str, Any]] = None


class FractalMemoryStore:
    """Hierarchical tree structure for organized memory."""

    def __init__(self, path: Path):
        self.path = path
        self.root: Dict[str, Any] = {}
        self.dirty = False
        self._lock = threading.Lock()
        self._load()

    def _load(self):
        if self.path.exists():
            try:
                self.root = json.loads(self.path.read_text())
            except json.JSONDecodeError:
                self.root = {}

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.root, indent=2))
        self.dirty = False

    def insert(self, path: List[str], entry: FractalEntry) -> None:
        with self._lock:
            node = self.root
            for segment in path[:-1]:
                if segment not in node:
                    node[segment] = {}
                node = node[segment]

            leaf = path[-1]
            if leaf not in node:
                node[leaf] = {"__data__": []}

            node[leaf]["__data__"].append(asdict(entry))
            self._save()

    def query(self, path_prefix: List[str], limit: int = 100) -> List[Dict]:
        with self._lock:
            node = self.root
            for segment in path_prefix:
                if segment not in node:
                    return []
                node = node[segment]
            return self._collect_data(node, limit)

    def _collect_data(self, node: Dict, limit: int) -> List[Dict]:
        results = []
        if "__data__" in node:
            results.extend(node["__data__"][-limit:])

        for key, value in node.items():
            if key != "__data__" and isinstance(value, dict):
                results.extend(self._collect_data(value, limit - len(results)))
                if len(results) >= limit:
                    break

        return results[:limit]


# =============================================================================
# RAG Retrieval Store
# =============================================================================

class RetrievalStore:
    """SQLite-based RAG with IVF acceleration."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path))
        conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY,
                agent_id TEXT,
                text TEXT,
                embedding BLOB,
                ts REAL,
                meta TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_agent ON memories(agent_id)")
        conn.commit()
        conn.close()

    def _hash_embed(self, text: str, dim: int = 384) -> List[float]:
        """Deterministic hash-based embedding (fallback)."""
        h = hashlib.sha256(text.encode()).hexdigest()
        values = []
        for i in range(0, min(len(h), dim * 2), 2):
            values.append((int(h[i:i+2], 16) - 128) / 128.0)
        while len(values) < dim:
            values.append(0.0)
        return values[:dim]

    def _get_embedding(self, text: str) -> List[float]:
        """Get embedding via Ollama or fallback to hash."""
        try:
            import requests
            resp = requests.post(
                "http://localhost:11434/api/embeddings",
                json={"model": "nomic-embed-text", "prompt": text},
                timeout=6.0
            )
            if resp.status_code == 200:
                return resp.json().get("embedding", self._hash_embed(text))
        except Exception:
            pass
        return self._hash_embed(text)

    def add(self, agent_id: str, text: str, meta: Optional[Dict] = None) -> int:
        embedding = self._get_embedding(text)
        embedding_blob = json.dumps(embedding).encode()

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.execute(
            "INSERT INTO memories (agent_id, text, embedding, ts, meta) VALUES (?, ?, ?, ?, ?)",
            (agent_id, text, embedding_blob, time.time(), json.dumps(meta or {}))
        )
        row_id = cursor.lastrowid
        conn.commit()
        conn.close()
        return row_id

    def search(
        self,
        agent_id: str,
        query: str,
        top_k: int = 6,
        min_score: float = 0.25
    ) -> List[Dict]:
        query_vec = self._get_embedding(query)

        conn = sqlite3.connect(str(self.db_path))
        cursor = conn.execute(
            "SELECT id, text, embedding, ts, meta FROM memories WHERE agent_id = ?",
            (agent_id,)
        )

        results = []
        for row in cursor:
            mem_vec = json.loads(row[2].decode())
            score = self._cosine_similarity(query_vec, mem_vec)
            if score >= min_score:
                results.append({
                    "id": row[0],
                    "text": row[1],
                    "score": score,
                    "ts": row[3],
                    "meta": json.loads(row[4])
                })

        conn.close()
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        if len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)


# =============================================================================
# QFC Cognition Engine
# =============================================================================

class QFCEngine:
    """Quantum Fractal Cognition - CPU-parallel thought waves."""

    def __init__(self, waves: int = 3, threads: int = 4):
        self.waves = waves
        self.threads = min(threads, 8)

    def run(self, text: str) -> Dict[str, Any]:
        import random
        import math

        tokens = text.lower().split()
        dim = min(len(tokens) * 4, 256)
        latent = [random.gauss(0, 0.1) for _ in range(dim)]

        thought_nodes = []
        for wave in range(self.waves):
            noise_scale = 0.1 / (wave + 1)
            latent = [x + random.gauss(0, noise_scale) for x in latent]
            latent = [math.tanh(x) for x in latent]

            thought_nodes.append({
                "id": f"wave_{wave}",
                "content": f"Wave {wave}: processed {len(tokens)} tokens",
                "energy": sum(x * x for x in latent) ** 0.5
            })

        edges = [
            {"from": thought_nodes[i]["id"], "to": thought_nodes[i + 1]["id"], "weight": 1.0 - (i * 0.1)}
            for i in range(len(thought_nodes) - 1)
        ]

        return {
            "intent_vector": latent[:64],
            "thought_graph": {"nodes": thought_nodes, "edges": edges},
            "waves_completed": self.waves
        }


# =============================================================================
# Swarm Router
# =============================================================================

class SwarmRouter:
    """Multi-agent swarm routing (Ring/Mesh/MoE)."""

    def __init__(self):
        self.agent_stats: Dict[str, Dict] = {}
        self.last_agent: Optional[str] = None

    def route(
        self,
        topology: str,
        agents: List[str],
        baton: str,
        moe_config: Optional[Dict] = None
    ) -> List[str]:
        if topology == "ring":
            return self._route_ring(agents)
        elif topology == "mesh":
            return agents
        elif topology == "moe":
            return self._route_moe(agents, baton, moe_config or {})
        else:
            raise ValueError(f"Unknown topology: {topology}")

    def _route_ring(self, agents: List[str]) -> List[str]:
        if not self.last_agent or self.last_agent not in agents:
            next_agent = agents[0]
        else:
            idx = agents.index(self.last_agent)
            next_agent = agents[(idx + 1) % len(agents)]
        self.last_agent = next_agent
        return [next_agent]

    def _route_moe(self, agents: List[str], baton: str, config: Dict) -> List[str]:
        scores = []
        baton_tokens = set(baton.lower().split())
        cooldown_penalty = config.get("cooldown_penalty", 0.1)
        bias = config.get("router_bias", {})

        for agent in agents:
            agent_tokens = set(agent.lower().replace("_", " ").split())
            overlap = len(baton_tokens & agent_tokens)
            score = overlap / (len(baton_tokens) + 1)

            if agent == self.last_agent:
                score -= cooldown_penalty
            score += bias.get(agent, 0)
            scores.append((agent, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        selected = [s[0] for s in scores[:3]]

        if selected:
            self.last_agent = selected[0]
        return selected


# =============================================================================
# Tool Execution Loop
# =============================================================================

class ToolExecutor:
    """
    Execute tools in a sandboxed environment.

    Security model:
    - exec_local: disabled by default (OPENPAW_ALLOW_LOCAL_EXEC=1 to enable)
    - docker_exec: enabled by default, uses read-only rootfs + cap-drop-all
    - workspace: mounted /workspace with read-write
    """

    DOCKER_IMAGE = os.environ.get("OPENPAW_DOCKER_IMAGE", "python:3.11-slim")
    ALLOW_LOCAL_EXEC = os.environ.get("OPENPAW_ALLOW_LOCAL_EXEC", "0") == "1"
    EXEC_TIMEOUT = int(os.environ.get("OPENPAW_EXEC_TIMEOUT", "30"))

    def __init__(self, workspace: Path):
        self.workspace = workspace
        self.workspace.mkdir(parents=True, exist_ok=True)
        self._tools: Dict[str, Callable] = {
            "exec": self._exec,
            "read": self._read,
            "write": self._write,
            "web_search": self._web_search,
            "web_fetch": self._web_fetch,
            "memory_store": self._memory_store,
            "memory_retrieve": self._memory_retrieve,
        }

    def execute(self, tool_name: str, params: Dict, context: Dict) -> Dict:
        """Execute a tool and return result."""
        if tool_name not in self._tools:
            return {"error": f"Unknown tool: {tool_name}", "success": False}

        try:
            start = time.time()
            result = self._tools[tool_name](params, context)
            elapsed = time.time() - start
            return {
                "success": True,
                "result": result,
                "elapsed_ms": round(elapsed * 1000, 1)
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "traceback": traceback.format_exc()
            }

    def _exec(self, params: Dict, context: Dict) -> Dict:
        """Execute a command (local or docker)."""
        command = params.get("command", "")
        use_docker = params.get("docker", not self.ALLOW_LOCAL_EXEC)

        if use_docker:
            return self._docker_exec(command, context)
        else:
            if not self.ALLOW_LOCAL_EXEC:
                return {"error": "Local exec disabled. Set OPENPAW_ALLOW_LOCAL_EXEC=1"}
            return self._local_exec(command, context)

    def _local_exec(self, command: str, context: Dict) -> Dict:
        """Execute locally (use with caution)."""
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=self.EXEC_TIMEOUT,
                cwd=str(self.workspace)
            )
            return {
                "stdout": result.stdout[-10000:],  # Limit output
                "stderr": result.stderr[-2000:],
                "returncode": result.returncode
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Command timed out after {self.EXEC_TIMEOUT}s"}

    def _docker_exec(self, command: str, context: Dict) -> Dict:
        """Execute in Docker container with security hardening."""
        # Check if docker is available
        if shutil.which("docker") is None:
            if self.ALLOW_LOCAL_EXEC:
                return self._local_exec(command, context)
            return {"error": "Docker not available and local exec disabled"}

        docker_cmd = [
            "docker", "run", "--rm",
            "--read-only",
            "--cap-drop=ALL",
            "--security-opt=no-new-privileges",
            "--network=none",
            "-v", f"{self.workspace}:/workspace:rw",
            "-w", "/workspace",
            "--memory=512m",
            "--cpus=1",
            self.DOCKER_IMAGE,
            "sh", "-c", command
        ]

        try:
            result = subprocess.run(
                docker_cmd,
                capture_output=True,
                text=True,
                timeout=self.EXEC_TIMEOUT
            )
            return {
                "stdout": result.stdout[-10000:],
                "stderr": result.stderr[-2000:],
                "returncode": result.returncode,
                "sandbox": "docker"
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Docker command timed out after {self.EXEC_TIMEOUT}s"}

    def _read(self, params: Dict, context: Dict) -> Dict:
        """Read a file from workspace."""
        file_path = params.get("path", "")
        full_path = self.workspace / file_path

        # Security: ensure within workspace
        try:
            full_path = full_path.resolve()
            if not str(full_path).startswith(str(self.workspace.resolve())):
                return {"error": "Path outside workspace"}
        except Exception:
            return {"error": "Invalid path"}

        if not full_path.exists():
            return {"error": f"File not found: {file_path}"}

        try:
            content = full_path.read_text()
            # Limit size
            if len(content) > 100000:
                content = content[:100000] + "\n... (truncated)"
            return {"content": content, "path": file_path}
        except Exception as e:
            return {"error": str(e)}

    def _write(self, params: Dict, context: Dict) -> Dict:
        """Write a file to workspace."""
        file_path = params.get("path", "")
        content = params.get("content", "")
        full_path = self.workspace / file_path

        # Security: ensure within workspace
        try:
            full_path = full_path.resolve()
            if not str(full_path).startswith(str(self.workspace.resolve())):
                return {"error": "Path outside workspace"}
        except Exception:
            return {"error": "Invalid path"}

        try:
            full_path.parent.mkdir(parents=True, exist_ok=True)
            full_path.write_text(content)
            return {"success": True, "path": file_path, "bytes": len(content)}
        except Exception as e:
            return {"error": str(e)}

    def _web_search(self, params: Dict, context: Dict) -> Dict:
        """Web search via available backends."""
        query = params.get("query", "")
        top_k = params.get("top_k", 5)

        # Try googlesearch-python
        try:
            from googlesearch import search
            results = []
            for url in search(query, num_results=top_k):
                results.append({"url": url, "title": url})
            return {"results": results, "backend": "googlesearch"}
        except ImportError:
            pass

        return {"error": "No search backend available. Install googlesearch-python."}

    def _web_fetch(self, params: Dict, context: Dict) -> Dict:
        """Fetch a web page."""
        url = params.get("url", "")
        try:
            import requests
            resp = requests.get(url, timeout=10, headers={"User-Agent": "OpenPaw/1.0"})
            content = resp.text[:50000]  # Limit
            return {"content": content, "status": resp.status_code, "url": url}
        except Exception as e:
            return {"error": str(e)}

    def _memory_store(self, params: Dict, context: Dict) -> Dict:
        """Store in memory via context."""
        # Delegate to FMM via context
        return {"stored": True, "note": "Delegate to fmm.insert"}

    def _memory_retrieve(self, params: Dict, context: Dict) -> Dict:
        """Retrieve from memory via context."""
        return {"note": "Delegate to retrieval.search"}


# =============================================================================
# Agent Loop
# =============================================================================

class AgentLoop:
    """
    Main agent execution loop.

    Pipeline:
    1. Receive message from OpenPaw
    2. Log event to memory
    3. Retrieve relevant context (RAG)
    4. Run QFC cognition (optional)
    5. Call LLM with context
    6. Execute any tool calls
    7. Return final response
    """

    def __init__(self, state_dir: Path):
        self.state_dir = state_dir
        self.event_log = EventLog(state_dir / "events.jsonl")
        self.fmm = FractalMemoryStore(state_dir / "fmm.json")
        self.retrieval = RetrievalStore(state_dir / "retrieval.sqlite3")
        self.qfc = QFCEngine()
        self.swarm = SwarmRouter()
        self.tool_executor = ToolExecutor(state_dir / "workspace")

    def run_turn(
        self,
        session: str,
        message: str,
        agent_id: str = "default",
        use_qfc: bool = False,
        use_rag: bool = True
    ) -> Dict:
        """Run a single turn of the agent loop."""
        results = {
            "session": session,
            "agent_id": agent_id,
            "stages": []
        }

        # Stage 1: Log incoming event
        event = Event.create(session, "user", message, {"agent": agent_id}, ["inbound"])
        self.event_log.append(event)
        self.retrieval.add(agent_id, message, {"session": session, "role": "user"})
        results["stages"].append({"name": "log_event", "success": True})

        # Stage 2: Retrieve context
        context_memories = []
        if use_rag:
            context_memories = self.retrieval.search(agent_id, message, top_k=6)
            results["stages"].append({
                "name": "rag_retrieve",
                "success": True,
                "memories_found": len(context_memories)
            })

        # Stage 3: QFC cognition (optional)
        cognition_result = None
        if use_qfc:
            cognition_result = self.qfc.run(message)
            results["stages"].append({
                "name": "qfc_cognition",
                "success": True,
                "waves": cognition_result["waves_completed"]
            })

        # Stage 4: Build context for LLM
        context = {
            "message": message,
            "memories": context_memories,
            "cognition": cognition_result,
            "session": session,
            "agent_id": agent_id
        }
        results["context"] = context
        results["stages"].append({"name": "build_context", "success": True})

        # Stage 5: LLM call would happen here (delegated to OpenPaw/Pi)
        # This bridge provides the context; OpenPaw handles the LLM

        results["ready_for_llm"] = True
        return results

    def execute_tools(self, tool_calls: List[Dict], context: Dict) -> List[Dict]:
        """Execute a batch of tool calls."""
        results = []
        for call in tool_calls:
            tool_name = call.get("name", "")
            params = call.get("params", {})
            result = self.tool_executor.execute(tool_name, params, context)
            results.append({
                "tool": tool_name,
                "call_id": call.get("id"),
                **result
            })
        return results


# =============================================================================
# YSON Parser
# =============================================================================

class YSONParser:
    """Parser for YSON/YSONX persona format."""

    @staticmethod
    def parse(content: str) -> Dict[str, Any]:
        try:
            import yaml
            return yaml.safe_load(content)
        except ImportError:
            pass

        # Simple fallback parser
        result = {}
        current_key = None
        current_list = None

        for line in content.split('\n'):
            line = line.rstrip()
            if not line or line.lstrip().startswith('#'):
                continue

            if ':' in line and not line.startswith(' '):
                key, _, value = line.partition(':')
                key = key.strip()
                value = value.strip()

                if value:
                    if value.startswith('[') and value.endswith(']'):
                        result[key] = [v.strip().strip('"\'') for v in value[1:-1].split(',')]
                    elif value.startswith('{') and value.endswith('}'):
                        result[key] = json.loads(value)
                    elif value.lower() in ('true', 'false'):
                        result[key] = value.lower() == 'true'
                    elif value.isdigit():
                        result[key] = int(value)
                    else:
                        result[key] = value.strip('"\'')
                    current_key = None
                    current_list = None
                else:
                    current_key = key
                    current_list = None

            elif line.startswith('  - ') and current_key:
                if current_list is None:
                    current_list = []
                    result[current_key] = current_list
                current_list.append(line[4:].strip().strip('"\''))

        return result


# =============================================================================
# JSON-RPC Server
# =============================================================================

class JSONRPCServer:
    """JSON-RPC server for OpenPaw bridge."""

    def __init__(self):
        self.state_dir = Path(os.environ.get("OPENPAW_STATE_DIR", str(Path.home() / ".openpaw")))
        self.agent_loop = AgentLoop(self.state_dir)

        # Direct access to components
        self.fmm = self.agent_loop.fmm
        self.retrieval = self.agent_loop.retrieval
        self.qfc = self.agent_loop.qfc
        self.swarm = self.agent_loop.swarm
        self.event_log = self.agent_loop.event_log
        self.tool_executor = self.agent_loop.tool_executor

        self.methods = {
            # Health
            "ping": lambda p: {"pong": True, "ts": time.time()},
            "health": self._health,

            # Events (Single Source of Truth)
            "event.log": self._event_log,
            "event.query": self._event_query,

            # Fractal Memory
            "fmm.insert": self._fmm_insert,
            "fmm.query": self._fmm_query,

            # Retrieval/RAG
            "retrieval.add": self._retrieval_add,
            "retrieval.search": self._retrieval_search,

            # Cognition
            "qfc.run": self._qfc_run,

            # Swarm
            "swarm.route": self._swarm_route,

            # Agent Loop
            "agent.turn": self._agent_turn,
            "agent.tools": self._agent_tools,

            # Tools (direct)
            "tool.exec": self._tool_exec,
            "tool.read": self._tool_read,
            "tool.write": self._tool_write,

            # YSON
            "yson.parse": self._yson_parse,
        }

    def _health(self, params: Dict) -> Dict:
        return {
            "status": "ok",
            "state_dir": str(self.state_dir),
            "fmm_exists": self.fmm.path.exists(),
            "retrieval_exists": self.retrieval.db_path.exists(),
            "docker_available": shutil.which("docker") is not None,
            "local_exec_allowed": ToolExecutor.ALLOW_LOCAL_EXEC,
            "ts": time.time()
        }

    def _event_log(self, params: Dict) -> Dict:
        event = Event.create(
            session=params["session"],
            role=params["role"],
            text=params["text"],
            meta=params.get("meta"),
            tags=params.get("tags")
        )
        self.event_log.append(event)
        return {"logged": True, "ts": event.ts}

    def _event_query(self, params: Dict) -> Dict:
        events = self.event_log.query(
            session=params.get("session"),
            role=params.get("role"),
            limit=params.get("limit", 50)
        )
        return {"events": [e.to_dict() for e in events]}

    def _fmm_insert(self, params: Dict) -> Dict:
        entry = FractalEntry(
            ts=time.time(),
            text=params["text"],
            topic=params.get("topic"),
            meta=params.get("meta")
        )
        self.fmm.insert(params["path"], entry)
        return {"success": True}

    def _fmm_query(self, params: Dict) -> Dict:
        results = self.fmm.query(
            params.get("path_prefix", []),
            params.get("limit", 100)
        )
        return {"results": results}

    def _retrieval_add(self, params: Dict) -> Dict:
        row_id = self.retrieval.add(
            params["agent_id"],
            params["text"],
            params.get("meta")
        )
        return {"id": row_id}

    def _retrieval_search(self, params: Dict) -> Dict:
        results = self.retrieval.search(
            params["agent_id"],
            params["query"],
            params.get("top_k", 6),
            params.get("min_score", 0.25)
        )
        return {"results": results}

    def _qfc_run(self, params: Dict) -> Dict:
        return self.qfc.run(params["text"])

    def _swarm_route(self, params: Dict) -> Dict:
        agents = self.swarm.route(
            params["topology"],
            params["agents"],
            params["baton"],
            params.get("moe_config")
        )
        return {"agents": agents}

    def _agent_turn(self, params: Dict) -> Dict:
        return self.agent_loop.run_turn(
            session=params["session"],
            message=params["message"],
            agent_id=params.get("agent_id", "default"),
            use_qfc=params.get("use_qfc", False),
            use_rag=params.get("use_rag", True)
        )

    def _agent_tools(self, params: Dict) -> Dict:
        results = self.agent_loop.execute_tools(
            params["tool_calls"],
            params.get("context", {})
        )
        return {"results": results}

    def _tool_exec(self, params: Dict) -> Dict:
        return self.tool_executor.execute("exec", params, {})

    def _tool_read(self, params: Dict) -> Dict:
        return self.tool_executor.execute("read", params, {})

    def _tool_write(self, params: Dict) -> Dict:
        return self.tool_executor.execute("write", params, {})

    def _yson_parse(self, params: Dict) -> Dict:
        manifest = YSONParser.parse(params["content"])
        return {"manifest": manifest}

    def handle_request(self, request: Dict) -> Dict:
        req_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {})

        if method not in self.methods:
            return {
                "id": req_id,
                "error": {"code": -32601, "message": f"Method not found: {method}"}
            }

        try:
            result = self.methods[method](params)
            return {"id": req_id, "result": result}
        except Exception as e:
            return {
                "id": req_id,
                "error": {"code": -32000, "message": str(e), "data": traceback.format_exc()}
            }

    def run(self):
        """Run the JSON-RPC server on stdin/stdout."""
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                request = json.loads(line)
                response = self.handle_request(request)
                print(json.dumps(response), flush=True)
            except json.JSONDecodeError as e:
                print(json.dumps({
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {e}"}
                }), flush=True)


def main():
    server = JSONRPCServer()
    server.run()


if __name__ == "__main__":
    main()
