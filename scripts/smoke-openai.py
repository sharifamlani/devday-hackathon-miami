"""Smoke test: prove the OpenAI key, every model tier, and the Agents SDK work end to end.

Run from the repo root (runbook N4):
    .venv/Scripts/python.exe scripts/smoke-openai.py

Exits non-zero on any failure. Never prints the key.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel
from agents import Agent, ModelSettings, Runner, function_tool
from openai.types.shared import Reasoning

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

TIERS = ["OPENAI_MODEL_FLAGSHIP", "OPENAI_MODEL_DEFAULT", "OPENAI_MODEL_EFFICIENT", "OPENAI_MODEL_FAST"]
failures = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)


# 1. Key present
check("OPENAI_API_KEY set", bool(os.getenv("OPENAI_API_KEY")))

# 2. Every tier answers through the Responses API
client = OpenAI()
for var in TIERS:
    model = os.getenv(var)
    try:
        r = client.responses.create(model=model, input="Reply with the single word OK", max_output_tokens=200)
        check(f"{var}={model}", "OK" in r.output_text.upper(), repr(r.output_text[:20]))
    except Exception as e:
        check(f"{var}={model}", False, str(e)[:120])


# 3. Agents SDK: one tool call + structured output on the default tier
@function_tool
def lookup_nonprofit(name: str) -> str:
    """Return a fixed fact about a nonprofit (stand-in for a real data source)."""
    return f"{name} serves 1,200 families in Miami-Dade."


class Answer(BaseModel):
    families_served: int
    used_tool: bool


agent = Agent(
    name="Smoke",
    instructions="Use lookup_nonprofit, then report the number of families served.",
    model=os.getenv("OPENAI_MODEL_DEFAULT"),
    tools=[lookup_nonprofit],
    output_type=Answer,
    model_settings=ModelSettings(reasoning=Reasoning(effort=os.getenv("OPENAI_REASONING_EFFORT", "medium"))),
)
try:
    result = Runner.run_sync(agent, "How many families does Casa Example serve?")
    out = result.final_output
    tool_called = any(getattr(i, "type", "") == "tool_call_item" for i in result.new_items)
    check("Agents SDK tool call", tool_called)
    check("Agents SDK structured output", out.families_served == 1200, repr(out))
except Exception as e:
    check("Agents SDK run", False, str(e)[:160])

print(f"\n{len(failures)} failure(s)")
sys.exit(1 if failures else 0)
