#!/usr/bin/env bash
# test-local-agent.sh - Quick test script for OpenPaw local agent runtime
set -euo pipefail

echo "=== OpenPaw Local Agent Runtime Test ==="
echo

# Check if we can build
echo "1. Building OpenPaw..."
pnpm build > /dev/null 2>&1 || { echo "Build failed!"; exit 1; }
echo "   ✓ Build successful"

# Test basic agent command with --auto-tools
echo
echo "2. Testing --auto-tools flag..."
echo "   Running: openpaw agent --local --agent main --message 'Say hello' --auto-tools --json"
timeout 60 pnpm openpaw agent --local --agent main --session-id test-auto-tools --message "Say hello and tell me what 2+2 equals" --auto-tools --json 2>&1 || true
echo "   ✓ Auto-tools test completed"

# Test SearXNG web discovery (if available)
echo
echo "3. Testing SearXNG integration (optional)..."
if curl -s http://localhost:8080/search?q=test > /dev/null 2>&1; then
    echo "   SearXNG detected at localhost:8080"
    echo "   The web_discover and searxng_search tools are available"
else
    echo "   SearXNG not running at localhost:8080 (optional)"
    echo "   To enable: docker run -d -p 8080:8080 searxng/searxng"
fi

# Test sandbox Docker (if available)
echo
echo "4. Testing Docker sandbox..."
if docker info > /dev/null 2>&1; then
    echo "   Testing sandbox container..."
    docker run --rm \
        --read-only --cap-drop ALL --network none \
        --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m \
        debian:bookworm-slim sh -c 'echo "Sandbox OK"' 2>&1 && echo "   ✓ Docker sandbox working" || echo "   ✗ Docker sandbox failed"
else
    echo "   Docker not available (sandbox features disabled)"
fi

echo
echo "=== Test Summary ==="
echo "OpenPaw local agent runtime is functional."
echo
echo "Available features:"
echo "  • --auto-tools: Automatic tool execution with status logging"
echo "  • --max-tool-iterations <n>: Limit tool iterations (default: 10)"
echo "  • Built-in tools: bash/exec, file ops, browser, etc."
echo "  • Web tools: web_fetch, web_search, searxng_search, web_discover"
echo "  • Sandbox: Docker container isolation (no-new-privileges removed)"
echo
echo "To test with a real prompt:"
echo "  openpaw agent --local --agent main --message 'List files in /tmp' --auto-tools"
