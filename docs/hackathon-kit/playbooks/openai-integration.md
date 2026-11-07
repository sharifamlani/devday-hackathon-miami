# OpenAI API + Agents SDK + Codex — verified 2026-11-06

**Smoke N4: PASS (7/7).** Run `.venv/Scripts/python.exe scripts/smoke-openai.py` from the repo root.
It checks the key, a real completion from every model tier, and an Agents SDK run with a tool call
and structured output. This is the gate on the Miami DevDay Exchange "Acceptance Criteria:
Codex · OpenAI API · OpenAI Agents SDK", so it is verified rather than assumed.

## What the key can reach

| | |
|---|---|
| Auth | ✅ `/v1/models` lists 98 models |
| Real completions | ✅ all four tiers return `OK` through `/v1/responses` |
| Agents SDK | ✅ `openai-agents` 0.24.0 (import name `agents`), `openai` 3.46.0, in `.venv` (uv) |
| Codex CLI | ✅ `codex-cli` 0.167.0 installed (`npm i -g @openai/codex`). **Login is a human step:** `codex login` |

## The model lineup (Nov 2026)

One family, four price tiers. `.env` names them by **role**, so a new release is a one-line edit.

| Variable | Model | Use | ~Price per 1M in/out |
|---|---|---|---|
| `OPENAI_MODEL_FLAGSHIP` | `gpt-6-astra` | Hardest reasoning steps only | $10 / $50 |
| `OPENAI_MODEL_DEFAULT` | `gpt-6.1-sol` | Agents' default workhorse | $2 / $10 |
| `OPENAI_MODEL_EFFICIENT` | `gpt-6.1-terra` | Near-Sol quality, half price | $1 / $5 |
| `OPENAI_MODEL_FAST` | `gpt-6-luna` | High-volume classify / extract | $0.10 / $0.50 |

Prices come from third-party write-ups; model IDs come from the live `/v1/models` call.
**Credits are $50 of API per person.** Default to Sol. Astra costs about 5× Sol.

---

## 🚨 Trap 1: `temperature` breaks every call

Every GPT-6.x model returns **400 "Unsupported parameter: 'temperature'"**. Older templates and
LangChain defaults send `temperature=0`. Remove it everywhere. For determinism, pin the prompt and
use structured output.

## 🚨 Trap 2: the o-series is gone; reasoning is a setting

No `o3` / `o4-mini`. Pass `reasoning={"effort": ...}` (Responses API) or
`ModelSettings(reasoning=Reasoning(effort=...))` (Agents SDK).

| Effort | gpt-6.1-sol | gpt-6-luna |
|---|---|---|
| `none` | ❌ 400 | ✅ |
| `low` / `medium` / `high` / `xhigh` | ✅ | ✅ |

## Trap 3: the package and the import have different names

`pip install openai-agents`, but `from agents import Agent, Runner, function_tool`. A local file or
folder named `agents/` shadows the SDK. Don't create one (the kit's `agents/` folder lives under
`docs/hackathon-kit/`, which is fine).

## Trap 4: `max_tokens` is `max_output_tokens`

The Responses API calls it `max_output_tokens`. Give reasoning models headroom (≥ 200 even for
"reply OK"), because reasoning tokens count against the cap.

## Trap 5: Codex is the coding tool of record

Miami lists Codex as an acceptance criterion, and sibling DevDay events (Tokyo, Osaka) **banned
Claude Code and Cursor by name.** Until a host says otherwise (`event-brief.md` Q9), product code is
written in Codex, and the Codex session(s) where the core was built are kept, since other events
asked for a session ID. Claude Code is used for research, docs, planning and verification.

---

## Minimal agent (the shape the smoke test proves)

```python
from agents import Agent, ModelSettings, Runner, function_tool
from openai.types.shared import Reasoning
from pydantic import BaseModel

@function_tool
def lookup(name: str) -> str:
    """Docstring becomes the tool description."""
    return "..."

class Answer(BaseModel):
    field: int

agent = Agent(
    name="Helper",
    instructions="...",
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    tools=[lookup],
    output_type=Answer,                      # structured output, validated in the loop
    model_settings=ModelSettings(reasoning=Reasoning(effort="medium")),
)
result = Runner.run_sync(agent, "question")  # result.final_output is an Answer
```

Docs: https://openai.github.io/openai-agents-python
