# Donor Desk — DevDay Miami

Donor Desk is a hackathon project for small nonprofit fundraising teams. The primary application is an Atomic CRM based web frontend with a local Python service for donor records, gift history, duplicate review, deterministic scoring, organization research, and human-reviewed outreach. See [the living plan](plan.md), [the roadmap](ROADMAP.md), and [the demo script](docs/demo-script.md) for the current product and build status.

## Current architecture

The main app lives in `web/` and `service/`. The Python service uses FastAPI and SQLite; the frontend supports the donor workflow and outreach inbox. The hosted frontend can use a read-only snapshot, while the full demo service is intended to run locally. Review the service and web READMEs for their setup details.

```text
web/ (React / Vite CRM and outreach inbox)
  │ local API or read-only snapshot
  ▼
service/ (FastAPI, SQLite, ingestion, scoring, research, outreach)
```

## `stat-mcp` prototype

`stat-mcp/` is a separate Python FastMCP prototype for importing transaction events, deriving person summaries, identifying possible duplicates, and assessing a person against configurable criteria. It is not wired into the primary `service/` or `web/` application. It supports CSV, JSON, XLSX, DOCX, Markdown, and text, and runs on port 8010 by default. Its integration walkthrough, transaction/person contract, and tools are documented in [Agent Integration](stat-mcp/AGENT_INTEGRATION.md), [Required Fields](stat-mcp/REQUIRED_FIELDS.md), and [Tools](stat-mcp/TOOLS.md).

To run the prototype locally:

```sh
cd stat-mcp
cp -n .env.example .env
uv sync
uv run python -m stat_mcp.server
```

It serves MCP at `http://127.0.0.1:8010/mcp` and a tool catalog at `http://127.0.0.1:8010/tools`. See [stat-mcp dependencies](stat-mcp/DEPENDENCIES.md) before setting up the environment.

## Safety and data

Use synthetic records for development and demos. The `stat-mcp` service keeps datasets in process memory, sends unstructured input to OpenAI for extraction, and is not configured with authentication or durable storage. The main app's operating boundaries and demo-data rules are recorded in [plan.md](plan.md). Keep API keys server-side and never commit `.env` files.
