#!/usr/bin/env bash
set -euo pipefail

# OpenPaw Model Toggle - Requires YES confirmation before applying changes
# Adapted from OpenClaw

STATE_FILE="$HOME/.openpaw/state/model-toggle.json"
CONFIG_FILE="$HOME/.openpaw/openpaw.json"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

usage() {
  cat <<'USAGE'
Usage: openpaw-model-toggle.sh <ollama|codex|anthropic|restore> [<model>|--model <name>]

Commands:
  ollama     Select an Ollama model (from `ollama list`) and apply it
  codex      Switch back to the Codex model (default: openai-codex/gpt-5.2-codex)
  anthropic  Switch to Anthropic Claude (default: anthropic/claude-sonnet-4)
  restore    Restore the previous model saved in ~/.openpaw/state/model-toggle.json

Options:
  --model <name>  Specify model directly (skips menu)

Environment:
  OPENPAW_CODEX_MODEL      Override Codex target model
  OPENPAW_ANTHROPIC_MODEL  Override Anthropic target model

Safety:
  ⚠️  This tool requires typing YES before any changes are applied.
  Previous model is always saved for easy restore.
USAGE
  exit 1
}

die() {
  echo -e "${RED}Error: $*${NC}" >&2
  exit 1
}

info() {
  echo -e "${BLUE}$*${NC}"
}

warn() {
  echo -e "${YELLOW}$*${NC}"
}

success() {
  echo -e "${GREEN}$*${NC}"
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

update_agents_config() {
  local default_id="$1"
  local model="${2:-}"
  require_cmd python3
  python3 - "$CONFIG_FILE" "$default_id" "$model" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
default_id = sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 else ""

# Read or create config
if path.exists():
    data = json.loads(path.read_text())
else:
    data = {}

agents = data.setdefault("agents", {})
defaults = agents.get("defaults", {})
agent_list = agents.setdefault("list", [])

def find_entry(agent_id):
    for entry in agent_list:
        if entry.get("id") == agent_id:
            return entry
    return None

def ensure_entry(agent_id):
    entry = find_entry(agent_id)
    if entry is None:
        entry = {"id": agent_id}
        agent_list.append(entry)
    return entry

# Ensure main and ollama entries
main = ensure_entry("main")
ollama = ensure_entry("ollama")

# Clear default flag from all, set on target
for entry in agent_list:
    entry.pop("default", None)

target = find_entry(default_id)
if target is not None:
    target["default"] = True

# Setup ollama agent with workspace and tools
if ollama.get("workspace") is None:
    workspace = defaults.get("workspace")
    if workspace:
        ollama["workspace"] = workspace

tools = ollama.setdefault("tools", {})
exec_cfg = tools.setdefault("exec", {})
exec_cfg.setdefault("security", "allowlist")
exec_cfg.setdefault("ask", "off")

# Set model if provided
if model:
    model_cfg = ollama.get("model", {})
    if isinstance(model_cfg, str):
        model_cfg = {"primary": model_cfg}
    if not isinstance(model_cfg, dict):
        model_cfg = {}
    model_cfg["primary"] = model
    ollama["model"] = model_cfg

# Write config
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(data, indent=2) + "\n")
PY
}

ollama_list() {
  if command -v script >/dev/null 2>&1; then
    script -q /dev/null -c "ollama list" 2>/dev/null | tr -d '\r'
  else
    ollama list 2>/dev/null
  fi
}

get_current_model() {
  # Try openpaw first, fall back to reading config directly
  if command -v openpaw >/dev/null 2>&1; then
    openpaw config get agents.defaults.model.primary 2>/dev/null || echo ""
  elif [[ -f "$CONFIG_FILE" ]]; then
    python3 -c "
import json
from pathlib import Path
data = json.loads(Path('$CONFIG_FILE').read_text())
print(data.get('agents', {}).get('defaults', {}).get('model', {}).get('primary', ''))
" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

save_previous() {
  local prev="$1"
  local ts
  ts="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  mkdir -p "$(dirname "$STATE_FILE")"
  python3 - "$STATE_FILE" "$prev" "$ts" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
prev = sys.argv[2]
ts = sys.argv[3]

path.write_text(json.dumps({"previous": prev, "savedAt": ts}, indent=2) + "\n")
print(f"Saved previous model: {prev}")
PY
}

load_previous() {
  [[ -f "$STATE_FILE" ]] || die "No saved model found at $STATE_FILE"
  python3 - "$STATE_FILE" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
prev = data.get("previous", "")
if not prev:
    sys.exit(1)
print(prev)
PY
}

confirm() {
  echo
  warn "═══════════════════════════════════════════════════════════════"
  warn "  ⚠️  CONFIRMATION REQUIRED"
  warn "═══════════════════════════════════════════════════════════════"
  echo
  echo "Type YES to apply these changes. Anything else cancels."
  echo -n "> "
  read -r reply || true
  [[ "$reply" == "YES" ]] || die "Cancelled by user."
}

apply_change() {
  local target="$1"
  local default_agent="${2:-}"
  local ollama_model="${3:-}"

  local current
  current="$(get_current_model)"

  echo
  info "═══════════════════════════════════════════════════════════════"
  info "  OpenPaw Model Toggle"
  info "═══════════════════════════════════════════════════════════════"
  echo
  echo "Current model: ${current:-<not set>}"
  echo "New model:     $target"
  echo
  echo "Commands to run:"
  if command -v openpaw >/dev/null 2>&1; then
    echo "  openpaw config set agents.defaults.model.primary \"$target\""
    if [[ -n "$default_agent" ]]; then
      echo "  (set default agent to \"$default_agent\")"
    fi
    echo "  openpaw gateway restart"
  else
    echo "  (update $CONFIG_FILE directly)"
  fi

  confirm

  # Save previous model
  if [[ -n "$current" ]]; then
    save_previous "$current"
  fi

  # Apply changes
  if command -v openpaw >/dev/null 2>&1; then
    openpaw config set agents.defaults.model.primary "$target"
    if [[ -n "$default_agent" ]]; then
      update_agents_config "$default_agent" "$ollama_model"
    fi
    openpaw gateway restart
  else
    # Direct config update
    update_agents_config "${default_agent:-main}" "$target"
    warn "Gateway not restarted (openpaw CLI not found). Restart manually."
  fi

  success "✓ Model changed to: $target"
}

choose_ollama_model() {
  require_cmd ollama
  local list
  if ! list="$(ollama_list)"; then
    die "Failed to run: ollama list"
  fi

  local models=()
  while IFS= read -r line; do
    models+=("$line")
  done < <(printf '%s\n' "$list" | awk 'NR>1 && $1 != "" {print $1}')

  if [[ ${#models[@]} -eq 0 ]]; then
    die "No Ollama models found. Run: ollama pull <model>"
  fi

  echo >&2
  info "Available Ollama models:" >&2
  echo >&2
  local i
  for i in "${!models[@]}"; do
    printf '  %2d) %s\n' $((i + 1)) "${models[$i]}" >&2
  done
  echo >&2
  echo -n "Select a model (number or name): " >&2
  local choice
  read -r choice

  if [[ "$choice" =~ ^[0-9]+$ ]]; then
    local idx=$((choice - 1))
    if (( idx < 0 || idx >= ${#models[@]} )); then
      die "Invalid selection: $choice"
    fi
    printf '%s\n' "${models[$idx]}"
    return
  fi

  # Try to match by name
  local normalized="${choice#ollama/}"
  local m
  for m in "${models[@]}"; do
    if [[ "$m" == "$normalized" || "$m" == "$choice" ]]; then
      printf '%s\n' "$m"
      return
    fi
  done
  die "Model not found: $choice"
}

main() {
  [[ $# -ge 1 ]] || usage

  case "$1" in
    ollama)
      shift
      local model=""
      if [[ $# -ge 1 && "$1" != "--model" ]]; then
        model="$1"
        shift
      elif [[ $# -ge 2 && "$1" == "--model" ]]; then
        model="$2"
        shift 2
      fi
      if [[ -z "$model" ]]; then
        model="$(choose_ollama_model)"
      fi
      model="${model#ollama/}"
      apply_change "ollama/$model" "ollama" "ollama/$model"
      ;;
    codex)
      local codex_model
      codex_model="${OPENPAW_CODEX_MODEL:-openai-codex/gpt-5.2-codex}"
      apply_change "$codex_model" "main"
      ;;
    anthropic)
      local anthropic_model
      anthropic_model="${OPENPAW_ANTHROPIC_MODEL:-anthropic/claude-sonnet-4}"
      apply_change "$anthropic_model" "main"
      ;;
    restore)
      local prev
      prev="$(load_previous)"
      info "Restoring previous model: $prev"
      if [[ "${prev%%/*}" == "ollama" ]]; then
        apply_change "$prev" "ollama" "$prev"
      else
        apply_change "$prev" "main"
      fi
      ;;
    -h|--help|help)
      usage
      ;;
    *)
      die "Unknown command: $1. Use -h for help."
      ;;
  esac
}

main "$@"
