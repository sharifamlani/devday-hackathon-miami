"""POST /chat/stream: the chat agent streamed to assistant-ui (plan.md §21.6.3 B10, §21.6.4 lift list).

assistant-stream (MIT) carries the chunks; this module maps Agents SDK stream events onto them:

    output text delta                  -> text delta
    tool_called (RunItemStreamEvent)   -> tool-call part (name + JSON args): the UI's step card
    tool_output                        -> that part's result: {summary, status, undo_token, result}
    run paused for approval            -> each pending call's result is {status: "awaiting_approval", run_id,
                                          call_id}, plus a data chunk {type: "approvals", run_id, approvals}
                                          so the UI can show approval cards; POST /chat/approve resumes it

Same agent, tools and pause/resume store as POST /chat (service.chat_agent).
"""
from __future__ import annotations

import uuid

from agents import Runner
from assistant_stream import create_run
from assistant_stream.serialization import DataStreamResponse

from service import chat_agent as ca


def call_id_of(raw) -> str | None:
    if isinstance(raw, dict):
        return raw.get("call_id") or raw.get("id")
    return getattr(raw, "call_id", None) or getattr(raw, "id", None)


async def map_events(controller, result, ctx: ca.ChatContext, spec: dict) -> None:
    """Drain one streamed run into the assistant-stream controller."""
    open_calls, steps = {}, []
    async for event in result.stream_events():
        if event.type == "raw_response_event":
            if getattr(event.data, "type", "") == "response.output_text.delta":
                controller.append_text(event.data.delta)
        elif event.type == "run_item_stream_event" and event.name == "tool_called":
            raw = event.item.raw_item
            call_id = call_id_of(raw)
            tool = await controller.add_tool_call(getattr(raw, "name", "tool"), call_id)
            tool.append_args_text(getattr(raw, "arguments", None) or "{}")
            open_calls[call_id] = tool
        elif event.type == "run_item_stream_event" and event.name == "tool_output":
            call_id = call_id_of(event.item.raw_item)
            data = ca.output_data(event.item.output)
            summary = ca.summarize(event.item.output)
            tool_name = getattr(open_calls.get(call_id), "tool_name", "") or ""
            if tool_name.startswith("delete_") and not summary.startswith("error"):
                summary = "deleted: " + summary.split(": ", 1)[-1]
            step = {"tool": tool_name or None, "call_id": call_id,
                    "summary": summary, "status": "error" if summary.startswith("error") else "done",
                    "undo_token": data.get("undo_token"), "card": data.get("card")}
            steps.append(step)
            if call_id in open_calls:
                open_calls.pop(call_id).set_response({**step, "result": data}, is_error=step["status"] == "error")

    approvals = ca.approval_items(getattr(result, "interruptions", None))
    if approvals:
        run_id = uuid.uuid4().hex
        ca.PENDING[run_id] = {**spec, "state": result.to_state().to_string(), "steps": steps}
        for a in approvals:
            if a["call_id"] in open_calls:
                open_calls.pop(a["call_id"]).set_response(
                    {"tool": a["tool"], "status": "awaiting_approval",
                     "summary": f"waiting for your approval to {a['tool'].split('_')[0]}",
                     "run_id": run_id, "call_id": a["call_id"]})
        controller.add_data({"type": "approvals", "run_id": run_id, "approvals": approvals})
    for tool in open_calls.values():          # anything left unanswered (e.g. max turns): close its card
        tool.set_response({"status": "error", "summary": "no result"}, is_error=True)
    if ctx.batches:
        from service import routes_campaigns as rc
        from service import db
        conn = db.connect()
        try:
            controller.add_data({"type": "pending_batch", "batch": ca.pending_batch(rc.campaign_detail(conn, ctx.batches[-1]))})
        finally:
            conn.close()


def stream_chat(message: str, tab: str, selection: list[int] | None = None, history: list[dict] | None = None,
                event_id: int | None = None) -> DataStreamResponse:
    turns = [{"role": h["role"], "content": h["content"]} for h in (history or [])[-12:]
             if h.get("role") in ("user", "assistant") and h.get("content")]
    spec = {"tab": tab, "selection": list(selection or []), "event_id": event_id, "first_turn": not turns}
    ctx = ca.ChatContext(tab=tab, selection=spec["selection"])
    agent = ca.build_agent(tab, spec["selection"], event_id, spec["first_turn"])

    async def run(controller):
        result = Runner.run_streamed(agent, turns + [{"role": "user", "content": message}], context=ctx,
                                     max_turns=12)
        await map_events(controller, result, ctx, spec)

    return DataStreamResponse(create_run(run))
