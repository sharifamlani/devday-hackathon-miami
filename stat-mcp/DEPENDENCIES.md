# `stat-mcp` dependency ledger

Update this file whenever a dependency is installed or first used by the service. “Used in source” means code imports or calls the package; it does not mean the package was installed or executed in this checkout. Exact resolved versions belong in `uv.lock` after environment setup.

## Runtime dependencies

| Dependency | Package / import | Status in this update | Why it is here |
| --- | --- | --- | --- |
| Python | Python `>=3.11` | Required by project manifest; `uv sync` completed in the project environment | MCP service, data processing, and agent orchestration. `StrEnum` sets the minimum to 3.11. |
| FastMCP | `fastmcp` / `from fastmcp import FastMCP` | Declared `>=4,<5`; installed `4.1.6`; used in `src/stat_mcp/server.py` | Hosts the MCP tools over Streamable HTTP. |
| OpenAI Agents SDK | `openai-agents` / `from agents import Agent, Runner` | Declared `>=0.5,<1`; installed `0.20.0`; used in `src/stat_mcp/agent.py` | Performs structured, per-donor criterion assessments with an LLM. |
| OpenAI Python SDK | `openai` / `from openai import OpenAI` | Declared `>=2,<3`; installed `2.54.0`; used by `scripts/smoke-openai.py` and transitively by the Agents SDK | Provides the official Python client and Responses API used by the SDK smoke script. |
| pandas | `pandas` | Declared `>=2.2,<4`; installed `3.1.1`; used in CSV/XLSX readers in `src/stat_mcp/file_ingest.py` | Parses tabular records and all Excel worksheets. |
| openpyxl | `openpyxl` | Declared `>=3.1,<4`; installed `3.1.5` on 2026-11-07 | Excel engine for `.xlsx` uploads. |
| python-docx | `python-docx` / `docx` | Declared `>=1.1,<2`; installed `1.2.0` on 2026-11-07 | Reads paragraphs and tables from `.docx` uploads. |
| Pydantic | `pydantic` | Declared `>=2.12,<3`; installed `2.14.3`; used in `src/stat_mcp/schemas.py` | Validates donor rows, custom criteria, agent outputs, and score inputs. |
| python-dotenv | `python-dotenv` / `dotenv` | Declared `>=1,<2`; installed `1.2.4`; used in server and agent startup | Loads local `.env` settings during development. |
| Starlette | `starlette` | Declared `>=0.37,<2`; resolved to `1.10.0`; used in the `GET /tools` custom route | Provides the typed HTTP request and JSON response for the human-readable tool catalog. FastMCP also uses Starlette for HTTP serving. |

## Development dependencies

| Dependency | Package | Status | Purpose |
| --- | --- | --- | --- |
| uv | `uv` | Setup tool; sync completed | Create the project environment and resolve dependencies with `uv sync`. |
| pytest | `pytest` | Optional dependency group `dev`; not installed | Unit tests for parsers, matching, aggregation, and tool contracts. |
| Ruff | `ruff` | Optional dependency group `dev`; not installed | Python formatting and linting. |

## Optional JavaScript client

| Dependency | Package / import | Status | Purpose |
|---|---|---|---|
| Node.js | Node `>=20` | Runtime requirement for `client-js/`; no system Node runtime was available in the development environment | Runs the server-side JavaScript MCP client. |
| MCP JavaScript SDK | `@modelcontextprotocol/sdk` | Declared `^1.0.0`; resolved/installed `1.32.2` with pnpm on 2026-11-07 | Connects the Node main-server adapter to FastMCP using Streamable HTTP. |
| pnpm | `pnpm` | `11.25.0` used to resolve and install the client package | Installs JavaScript client dependencies. |

## Setup

Run `./stat-mcp/scripts/init-and-run.sh` from the repository root. It creates `.env` from the blank template only when absent, runs `uv sync`, and starts the server. Alternatively, from `stat-mcp/`, run `uv sync` and `uv run python -m stat_mcp.server`. Install the optional JavaScript client with `pnpm install` from `stat-mcp/client-js/`. Set `OPENAI_API_KEY` for LLM extraction/scoring. The server defaults to `127.0.0.1:8010` to avoid the primary service on port 8000; configure HTTPS and authentication before remote use.

`uv sync` completed on 2026-11-07 after adding the Excel and Word readers; `uv.lock` includes `openpyxl` and `python-docx`. `pnpm install` resolved and installed the JavaScript MCP client dependency. The optional Python `dev` group was not installed; no OpenAI API call was made and tests were not run. The smoke script requires a valid key and incurs API usage.

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
