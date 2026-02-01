#!/usr/bin/env bash
set -euo pipefail

# OpenPaw/OpenClaw Gateway Switcher
# Usage: switch-gateway.sh <openpaw|openclaw>

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

show_status() {
  echo -e "${YELLOW}Current Gateway Status:${NC}"
  systemctl --user is-active openclaw-gateway.service 2>/dev/null && echo "  OpenClaw: running" || echo "  OpenClaw: stopped"
  systemctl --user is-active openpaw-gateway.service 2>/dev/null && echo "  OpenPaw:  running" || echo "  OpenPaw:  stopped"
}

case "${1:-status}" in
  openpaw|paw)
    echo -e "${YELLOW}Switching to OpenPaw gateway...${NC}"
    systemctl --user stop openclaw-gateway.service 2>/dev/null || true
    systemctl --user daemon-reload
    systemctl --user enable openpaw-gateway.service
    systemctl --user start openpaw-gateway.service
    sleep 2
    echo -e "${GREEN}OpenPaw gateway started.${NC}"
    show_status
    ;;
  openclaw|claw)
    echo -e "${YELLOW}Switching to OpenClaw gateway...${NC}"
    systemctl --user stop openpaw-gateway.service 2>/dev/null || true
    systemctl --user enable openclaw-gateway.service
    systemctl --user start openclaw-gateway.service
    sleep 2
    echo -e "${GREEN}OpenClaw gateway started.${NC}"
    show_status
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 <openpaw|openclaw|status>"
    exit 1
    ;;
esac
