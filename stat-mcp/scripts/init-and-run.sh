#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STAT_MCP_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
cd "$STAT_MCP_DIR"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required. Install it from https://docs.astral.sh/uv/getting-started/installation/" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created stat-mcp/.env from the blank template. Add OPENAI_API_KEY for narrative extraction and scoring."
fi

uv sync
exec uv run python -m stat_mcp.server
