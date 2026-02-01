# OpenPaw Cheatsheet

## Status & Health

```bash
openpaw --version                    # Version
openpaw doctor                       # Health check + fixes
openpaw channels status              # WhatsApp/Telegram/etc status
openpaw gateway status               # Gateway health
openpaw agents list                  # List agents
```

## Messages

```bash
# Send WhatsApp
openpaw message send -t "+1234567890" -m "Hello" --channel whatsapp

# Send with media
openpaw message send -t "+1234567890" -m "Photo" --media /path/to/image.jpg --channel whatsapp

# Send to Telegram
openpaw message send -t "@username" -m "Hello" --channel telegram

# Dry run (preview)
openpaw message send -t "+1234567890" -m "Test" --channel whatsapp --dry-run
```

## Agent Control

```bash
# Run agent turn
openpaw agent --message "Hello" --agent ollama

# Run with thinking
openpaw agent --message "Explain X" --thinking high

# Local embedded mode
openpaw agent --message "Hello" --local
```

## Gateway

```bash
openpaw gateway status               # Status
openpaw gateway run                  # Run foreground
openpaw gateway run --daemon         # Run background

# Systemd (Linux)
systemctl --user start openpaw-gateway
systemctl --user stop openpaw-gateway
systemctl --user restart openpaw-gateway
systemctl --user status openpaw-gateway
```

## Config

```bash
openpaw config                       # Interactive wizard
openpaw config get agents.defaults.model.primary
openpaw config set agents.defaults.model.primary "ollama/qwen3:32b"
openpaw config unset messages.responsePrefix
```

## Channels Login

```bash
openpaw channels login               # WhatsApp QR
openpaw channels login --channel telegram
openpaw channels logout
openpaw channels logout --channel whatsapp
```

## Model Toggle (YES confirmation)

```bash
openpaw-model-toggle ollama          # Select Ollama model (menu)
openpaw-model-toggle ollama --model qwen3:32b  # Direct select
openpaw-model-toggle codex           # Switch to Codex
openpaw-model-toggle anthropic       # Switch to Claude
openpaw-model-toggle restore         # Restore previous
```

## Memory & RAG

```bash
openpaw memory search "query"        # Search memories
openpaw memory list                  # List recent
```

## Logs

```bash
openpaw logs                         # View logs
openpaw logs --follow                # Follow mode
openpaw logs --lines 100             # Last 100 lines

# Direct log file
tail -f /tmp/openpaw/openpaw-$(date +%Y-%m-%d).log
```

## Pairing (DM Access)

```bash
openpaw pairing list whatsapp        # Pending requests
openpaw pairing approve whatsapp ABC123
openpaw pairing reject whatsapp ABC123
```

## Plugins

```bash
openpaw plugins list                 # List plugins
openpaw plugins install <name>       # Install
openpaw plugins uninstall <name>     # Remove
```

## Python Bridge (QJSON)

```bash
# Health check
echo '{"id":1,"method":"health","params":{}}' | python3 ~/Desktop/openpaw/python/qjson_bridge.py

# Agent turn
echo '{"id":1,"method":"agent.turn","params":{"session":"test","message":"Hello"}}' | python3 ~/Desktop/openpaw/python/qjson_bridge.py

# Memory insert
echo '{"id":1,"method":"fmm.insert","params":{"path":["test"],"text":"Note"}}' | python3 ~/Desktop/openpaw/python/qjson_bridge.py

# RAG search
echo '{"id":1,"method":"retrieval.search","params":{"agent_id":"main","query":"test"}}' | python3 ~/Desktop/openpaw/python/qjson_bridge.py
```

## Environment Variables

```bash
export OPENPAW_STATE_DIR=~/.openpaw
export OPENPAW_CONFIG_PATH=~/.openpaw/openpaw.json
export OPENPAW_GATEWAY_PORT=18789
export OPENPAW_ALLOW_LOCAL_EXEC=0    # 1 to enable local exec
export OPENPAW_DOCKER_IMAGE=python:3.11-slim
```

## Paths

```
~/.openpaw/openpaw.json              # Main config
~/.openpaw/credentials/              # Auth tokens
~/.openpaw/workspace/                # Agent workspace
~/.openpaw/agents/                   # Agent sessions
~/.openpaw/events.jsonl              # Event log
~/.openpaw/fmm.json                  # Fractal memory
~/.openpaw/retrieval.sqlite3         # RAG database
/tmp/openpaw/                        # Logs
```

## Quick Aliases (add to ~/.bashrc)

```bash
alias op='openpaw'
alias ops='openpaw channels status'
alias opg='openpaw gateway status'
alias opm='openpaw-model-toggle'
alias opl='openpaw logs --follow'
alias opsend='openpaw message send --channel whatsapp -t'
```

## Troubleshooting

```bash
# Reset config
openpaw reset --config

# Full reset
openpaw reset --all

# Debug mode
DEBUG=* openpaw gateway run

# Check port
ss -tlnp | grep 18789

# Kill zombie gateway
pkill -f "openpaw gateway"
```
