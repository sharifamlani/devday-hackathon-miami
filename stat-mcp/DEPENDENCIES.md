# `stat-mcp` dependency ledger

Update this file whenever a dependency is installed or first used by the service. “Used in source” means code imports or calls the package; it does not mean the package was installed or executed in this checkout. Exact resolved versions belong in `uv.lock` after environment setup.

## Runtime dependencies

| Dependency | Package / import | Status in this update | Why it is here |
| --- | --- | --- | --- |
| Python | Python `>=3.11` | Required by project manifest; `uv sync` completed in the project environment | MCP service, data processing, and agent orchestration. `StrEnum` sets the minimum to 3.11. |
| FastMCP | `fastmcp` / `from fastmcp import FastMCP` | Declared `>=4,<5`; installed `4.1.6`; used in `src/stat_mcp/server.py` | Hosts the MCP tools over Streamable HTTP. |
| OpenAI Agents SDK | `openai-agents` / `from agents import Agent, Runner` | Declared `>=0.5,<1`; installed `0.20.0`; used in `src/stat_mcp/agent.py` | Performs structured, per-donor criterion assessments with an LLM. |
| OpenAI Python SDK | `openai` / `from openai import OpenAI` | Declared `>=2,<3`; installed `2.54.0`; used by `scripts/smoke-openai.py` and transitively by the Agents SDK | Provides the official Python client and Responses API used by the SDK smoke script. |
| pandas | `pandas` | Declared `>=2.2,<4`; installed `3.1.1`; used in `src/stat_mcp/ingest.py` | Parses CSV exports into tabular records. |
| Pydantic | `pydantic` | Declared `>=2.12,<3`; installed `2.14.3`; used in `src/stat_mcp/schemas.py` | Validates donor rows, custom criteria, agent outputs, and score inputs. |
| python-dotenv | `python-dotenv` / `dotenv` | Declared `>=1,<2`; installed `1.2.4`; used in server and agent startup | Loads local `.env` settings during development. |
| Starlette | `starlette` | Declared `>=0.37,<2`; resolved to `1.10.0`; used in the `GET /tools` custom route | Provides the typed HTTP request and JSON response for the human-readable tool catalog. FastMCP also uses Starlette for HTTP serving. |

## Development dependencies

| Dependency | Package | Status | Purpose |
| --- | --- | --- | --- |
| uv | `uv` | Setup tool; sync completed | Create the project environment and resolve dependencies with `uv sync`. |
| pytest | `pytest` | Optional dependency group `dev`; not installed | Unit tests for parsers, matching, aggregation, and tool contracts. |
| Ruff | `ruff` | Optional dependency group `dev`; not installed | Python formatting and linting. |

## Setup

From `stat-mcp/`, run `uv sync` to install the declared dependencies and update `uv.lock`, then use `uv run python -m stat_mcp.server`. If no local `.env` exists, copy `.env.example` to `.env` and set `OPENAI_API_KEY` for LLM extraction/scoring. The server defaults to `127.0.0.1:8000`; configure deployment HTTPS and authentication before remote use.

`uv sync` completed on 2026-11-07, creating `uv.lock` and installing the runtime dependencies into `.venv`. It did not install the optional `dev` group, make an API call, or run tests. The smoke script requires a valid key and incurs API usage.

## Security and data handling

- `.env` is ignored by the repository. Keep the tracked `.env.example` blank; do not copy API keys into tracked files.
- Keep `OPENAI_API_KEY` server-side. The `score_donor` evaluator omits contact email/phone and arbitrary imported columns from its prompt, but the unstructured-text extraction path sends the submitted text to the configured OpenAI model.
- Use synthetic donor profiles for the prototype. In-memory data has no tenant or user access control.
- Never ingest payment-card data. A missing gift is not proof of payment failure.

## Sources

- [FastMCP installation and versions](https://gofastmcp.com/docs/getting-started/installation)
- [FastMCP server tools](https://gofastmcp.com/docs/servers/tools)
- [FastMCP running servers](https://gofastmcp.com/docs/deployment/running-server)
- [FastMCP custom HTTP routes](https://gofastmcp.com/docs/deployment/running-server)
- [OpenAI Agents SDK Python package metadata](https://github.com/openai/openai-agents-python/blob/main/pyproject.toml)
- [OpenAI Agents SDK MCP connections](https://openai.github.io/openai-agents-python/mcp/)
- [OpenAI Agents SDK structured output / tools](https://openai.github.io/openai-agents-python/tools/)
- [pandas documentation](https://pandas.pydata.org/docs/index.html)
- [Pydantic validation docs](https://pydantic.dev/docs/validation/latest/get-started/)
- [Annie Duke: decision making under uncertainty](https://www.annieduke.com/article-decision-making-by-thinking-in-bets-annie-duke/)
