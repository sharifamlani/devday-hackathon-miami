# Repos to lift (research, Sat Nov 7 2026)

Method: license and `pushed_at` read from the GitHub REST API (`api.github.com/repos/...`) or PyPI JSON, on Nov 7-8 2026. Where the API said NOASSERTION I read the LICENSE file. Directory listings come from the GitHub contents/tree API. Nothing was cloned or run. Items marked (unverified) were not confirmed from a primary page. Effort: S = under 1 h, M = 1-3 h, L = over 3 h.

## Top picks (one line each)

| Need | Top pick | Why |
|---|---|---|
| 1 Chat UI | assistant-ui (already in the app) + `makeAssistantToolUI` approval cards | MIT, pushed today, React 19, runs as a plain Vite SPA, already installed |
| 2 Dictation + live transcript | `google-gemini/live-api-web-console` `src/lib/audio-recorder.ts` + `src/lib/worklets/audio-processing.ts`, wrapped in an assistant-ui `DictationAdapter` | Apache-2.0, working AudioWorklet to PCM16 capture; adapter interface fits a WebSocket |
| 3 FastAPI relay | Hand-written ~60-line relay (two asyncio loops) modeled on `gemilive` and ADK's custom-streaming-ws doc | Key stays on the server; `gemilive` is MIT but 0.1.1 and a month old |
| 4 Tasks + mini calendar | shadcn `calendar` (react-day-picker) + `originui` task/calendar snippets | MIT, copy-paste, matches existing Tailwind/shadcn |
| 5 Agents SDK patterns | `examples/agent_patterns/human_in_the_loop_server.py` and `human_in_the_loop_stream.py` | MIT, official, shows `needs_approval` plus resume with run state |
| 6 Twilio | Twilio REST Calls API with `record=True` + `recording_status_callback`, via `twilio-python` | MIT; no maintained FastAPI record sample found, so write ~40 lines |
| 7 Palette + gauge | `cmdk` through shadcn `command` (CommandDialog) + shadcn `chart` radial | MIT; both are shadcn-native |

## 1. Agent chat UI

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| assistant-ui/assistant-ui | MIT (API) | 2026-11-08 | `examples/with-ai-sdk-v7`, `examples/with-external-store`, `examples/with-generative-ui`, `examples/with-custom-thread-list`, `examples/with-elevenlabs-scribe` (dictation over WS), `examples/with-interactables`. Tool UI and approval: docs "Part 3: Approval UI" (`makeAssistantToolUI` + `addResult({approve:false})`). Attachments and dictation adapters ship in `@assistant-ui/react` | Vite OK (Vite-based examples: `with-react-router`, `with-tanstack`). Bring your own backend through `useLocalRuntime`, external store, or the AI SDK data-stream runtime | S (already wired) |
| prompt-kit (ibelick) | MIT (API) | 2026-09-28 | `npx shadcn add prompt-kit/prompt-input`, `suggestion`, `loader`, `message`, `chain-of-thought` (component set from README; list unverified) | Pure shadcn registry, no Next.js dependency; good for suggestion chips and a composer skin | S |
| vercel/ai-elements | Apache-2.0 (LICENSE file; API says NOASSERTION) | 2026-10-14 | `conversation`, `message`, `prompt-input`, `tool`, `confirmation` (names unverified except conversation/message/code-block) | README says it deprecates end of Nov 2026 in favor of a shadcn/ui version; docs assume Next.js plus `@ai-sdk/react` `useChat` | M, avoid |
| vercel/ai (AI SDK UI, `@ai-sdk/react`) | Apache-2.0 (LICENSE file) | 2026-11-07 | `useChat` and the UI-message-stream wire format | Works against any HTTP endpoint that emits the stream with header `x-vercel-ai-ui-message-stream: v1` | M |
| CopilotKit/CopilotKit | MIT (API) | 2026-11-07 | `CopilotChat`, human-in-the-loop hooks | See the pairing section; Agents SDK is not in its listed backends | M-L |
| langchain-ai/agent-chat-ui | MIT (API) | 2026-11-03 | `src/components/thread/*` | A Next.js app that needs a LangGraph deployment URL; no mention of approvals or tool-call rendering on its README | L, avoid |
| openai/openai-chatkit-advanced-samples | MIT (LICENSE file; API says NOASSERTION) | 2026-08-01 | Sample backends for the ChatKit protocol | ChatKit's widget is OpenAI-hosted/closed; the Python server is a backend for that widget, not a UI we can restyle (unverified) | skip |

## 2. Voice dictation and live transcript (browser)

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| google-gemini/live-api-web-console | Apache-2.0 (API + sidebar) | 2026-06-21 | `src/lib/audio-recorder.ts`, `src/lib/worklets/audio-processing.ts` (1.9 KB, mic to Int16), `src/lib/audioworklet-registry.ts`, `src/lib/audio-streamer.ts` (playback, only if the call panel speaks), `src/lib/worklets/vol-meter.ts`, `src/components/audio-pulse/AudioPulse.tsx` (level meter), `src/lib/genai-live-client.ts` (event emitter, replace its direct-to-Google connection with our WS) | CRA-era React 18 but these `lib/` files are framework-free TS. Keep Apache NOTICE and header comments (the repo goes public under MIT; Apache files stay Apache) | S-M |
| assistant-ui dictation (`DictationAdapter`, `ComposerPrimitive.Dictate`) | MIT | 2026-11-08 | Adapter contract: `listen()` returns session with `stop/cancel/onSpeechStart/onSpeech/onSpeechEnd`; results `{transcript, isFinal}`. Outline of a WebSocket adapter is in the docs guide `guides/dictation` | `isFinal:false` shows as preview text and is replaced by later results; set `disableInputDuringDictation = true` for cumulative text. Built-in `WebSpeechDictationAdapter` is the offline fallback if Gemini fails on stage | S |
| assistant-ui `examples/with-elevenlabs-scribe` | MIT | 2026-11-08 | Token-fetch + WS adapter wiring | Closest working template; swap the provider for our `/ws/dictate` | S |
| google-gemini/cookbook | Apache-2.0 (API) | 2026-11-05 | `quickstarts/Get_started_LiveAPI.ipynb` and `quickstarts-js/` (protocol reference only) | Notebooks, not an app. Use to confirm the config payload for input transcription | read-only |

Note: the live-api-web-console worklet emits 16 kHz Int16 PCM, which matches the `gemini-3.5-transcribe-live` input spec you gave. Chunk size is set in `audio-recorder.ts`; set ~100 ms.

## 3. FastAPI relay to Gemini Live, and ephemeral tokens

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| gemilive (PyPI, saidurpulok) | MIT (PyPI JSON) | 0.1.1, 2026-04-13 | Pattern: mount `/ws/live` WS proxy on existing FastAPI; JS SDK in the browser | Young package, docs mention a `gemini-3.1-flash-live-preview` model and 24 kHz playback; built for voice chat, not transcribe-only. Read the source, do not depend on it | M |
| Google ADK docs "custom streaming ws" | Docs (code samples Apache-2.0 in `google/adk-docs`; license not checked) | n/a | Session manager: browser WS to FastAPI to Live session, two concurrent tasks (upstream audio, downstream events) | Official reference for the relay shape | S (read) |
| google-gemini/cookbook `examples/gradio_audio.py` | Apache-2.0 | 2026-11-05 | Python Live session setup with `client.aio.live.connect` | Gradio UI is irrelevant; copy the connect/send/receive loop only | S |
| greathayat/google-gemini-live | not checked | n/a | FastAPI + React text/audio demo | Few stars, audio path unverified | skip |
| Ephemeral tokens (Gemini docs) | docs | n/a | `client.auth_tokens.create(config={'uses':1, 'live_connect_constraints':...})`; default 1 min to open the session and 30 min of life | Only needed if the browser connects straight to Google. Our design keeps the key server-side, so tokens are the fallback if relay latency hurts. Docs disagree on API version (`v1alpha`) and model names; copy from the live page | S |

Relay skeleton to write (no dependency): `@app.websocket("/ws/transcribe")` accepts the browser, opens `client.aio.live.connect(model="gemini-3.5-transcribe-live", config=...)`, runs `asyncio.gather(browser_to_gemini, gemini_to_browser)`. Browser frames are raw PCM bytes; downstream frames are JSON `{text, isFinal}`. Authenticate the WS with the same session as the REST API.

## 4. Tasks list and small month calendar

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| shadcn-ui/ui `calendar` | MIT (API) | 2026-11-07 | `npx shadcn add calendar` (wraps react-day-picker, MIT, not separately checked). Use `modifiers` and `components.DayButton` for event dots | Already your stack. Docs page truncated before the custom-day section, so check the "Custom day" snippet in the docs | S |
| origin-space/originui | MIT (API) | 2026-11-05 | Registry snippets: `comp-` calendar, checkbox, and card variants (browse originui.com; names unverified) | Pure Tailwind + shadcn primitives | S |
| shadcn blocks (`dashboard-01`, `calendar-*`) | MIT (same repo) | 2026-11-07 | `npx shadcn add dashboard-01`, `calendar-31` style blocks (block names unverified) | Task-card layout ideas; strip charts you do not need | S |
| react-big-calendar (already used) | MIT | not checked | Keep for the full calendar page | Do not duplicate; the mini widget is just day-picker + dots | none |

## 5. OpenAI Agents SDK patterns

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| openai/openai-agents-python `examples/agent_patterns/` | MIT (API) | 2026-11-08 | `human_in_the_loop.py` (interruptions, `state.approve()/reject()`, resume), `human_in_the_loop_stream.py` (same with streaming), `human_in_the_loop_server.py` (state serialized between HTTP requests, this is the FastAPI shape), `human_in_the_loop_custom_rejection.py` (rejection message), `agents_as_tools_structured.py` (typed outputs) | Contents not opened (listing only); `docs/human_in_the_loop.md` in the same repo is the explainer. `needs_approval` is set on `function_tool` | S-M |
| same repo `examples/tools/shell_human_in_the_loop.py` | MIT | 2026-11-08 | Approval on a shell tool | Reference only | none |
| same repo, structured outputs | MIT | 2026-11-08 | `Agent(output_type=PydanticModel)`; use for the after-call extraction agent: input = transcript, output = `CallNotes{summary, pledges[], tasks[], follow_up_date}` | Docs page `agents` covers it; no example file name confirmed | S |

Proposal pattern: agent tools that write (create task, log note, schedule event) are `needs_approval=True`. The run returns `interruptions`; the API streams each as a `tool-input-available` card with the proposed arguments; Approve/Discard posts back to `/chat/resume` with the serialized `RunState`.

## 6. Twilio call recording and transcription (stretch)

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| twilio/twilio-python | MIT (API) | 2026-11-05 | `client.calls.create(to, from_, url, record=True, recording_status_callback=..., recording_status_callback_event=["completed"])` | Official helper lib | S |
| twilio-samples/speech-assistant-openai-realtime-api-python | MIT (API) | 2025-09-02 | FastAPI `/incoming-call` TwiML + `/media-stream` WS skeleton | It is a live media-stream bridge, not record-and-webhook; reuse only the FastAPI TwiML pattern | M |
| Twilio docs "record phone calls with Python" | docs | n/a | `<Record>`/`record=true`, `RecordingStatusCallback` POST fields (`RecordingUrl`, `RecordingSid`, `CallSid`, `RecordingDuration`) | `RecordingDuration` only on `completed`. Fetch `RecordingUrl + ".mp3"` with basic auth, then send to `gemini-3.5-transcribe` for diarization | S |

I did not find a maintained `twilio-samples` FastAPI repo for record plus status webhook. Write the ~40 lines directly. Needs a public URL (ngrok or the Vercel/Cloud host) and a verified Twilio number.

## 7. Command palette and goal gauge

| Repo / package | License (verified) | Last activity | What to copy | Fit notes | Effort |
|---|---|---|---|---|---|
| pacocoursey/cmdk | MIT (API) | 2025-10-29 | Through `npx shadcn add command` (`CommandDialog`, `CommandInput`, `CommandItem`) | Last push a year old but stable and used by shadcn. Fetch donors from `/donors?q=` debounced; set `shouldFilter={false}` so server results are not refiltered | S |
| shadcn `chart` (Recharts wrapper) radial examples | MIT | 2026-11-07 | `npx shadcn add chart`; use `RadialBarChart` with `startAngle=0 endAngle={pct*3.6}` and the center `Label` | Six radial examples on ui.shadcn.com/charts/radial; names not shown in the fetch, open "View Code" | S |
| recharts | MIT (not re-checked) | n/a | `RadialBarChart`, `PolarAngleAxis domain={[0,100]}` | Needed by shadcn chart anyway | S |

## Agent framework + chat UI pairing

| | (a) OpenAI Agents SDK + assistant-ui | (b) LangGraph + assistant-ui `react-langgraph` or agent-chat-ui | (c) CopilotKit |
|---|---|---|---|
| License | SDK MIT, assistant-ui MIT, `assistant-stream` (PyPI 0.0.36, Aug 2026) MIT classifier | LangGraph MIT, agent-chat-ui MIT, assistant-ui MIT | MIT (API) |
| Server needed | Plain FastAPI endpoint | assistant-ui docs list a LangGraph Cloud/Platform-style API (client + assistant ID); agent-chat-ui requires a deployment URL and is Next.js. Self-hosting a compatible server was not confirmed. `@assistant-ui/react-langchain` (wraps `useStream`) is the lighter option | Runtime layer plus AG-UI; the backends page lists ADK, PydanticAI, Agno, Claude Agent SDK, not OpenAI Agents SDK. Frontends include plain React |
| Tool calls / approval in UI | `makeAssistantToolUI` renders each tool call; approval via `addResult`, or the Vue docs show `respondToApproval`/`resume` callbacks, so the React equivalents likely exist (unverified). Approval state is ours: Agents SDK `interruptions` -> card -> resume endpoint | LangGraph `interrupt()` pauses; assistant-ui has an Interrupts page and a "Part 3: Approval UI" tutorial with `makeAssistantToolUI`. State lives in LangGraph checkpoints | `useHumanInTheLoop`-style hooks (name unverified); AG-UI events carry tool calls |
| Existing adapters | None official found. Closest: assistant-ui `useExternalStoreRuntime` or `useLocalRuntime` (you own the stream parsing); `assistant-stream` Python package emits the assistant-ui data-stream format from FastAPI; `vercel-ai-sdk` Python package (experimental) has a FastAPI+Vite example with hook-based approval, but is not tied to the Agents SDK. Pydantic AI has a built-in AI SDK adapter (reference to copy, not our SDK) | Official: `@assistant-ui/react-langgraph` | AG-UI Python server quickstart; no Agents SDK adapter found |
| Effort to wire people/CRM, calendar, tasks, call notes | M: keep the 4 tool groups as `function_tool`s as-is; write one ~100-line event mapper (`stream_events()` text deltas and tool items -> data-stream chunks) plus resume route | L: port tools to LangChain `@tool`, add graph state, run a LangGraph server or write an API shim, retest approvals | L: port to AG-UI event emitter; Agents SDK unsupported, so a custom bridge |
| Risk with the freeze at Sun 4:15 PM | Lowest: no framework change | High: new runtime and server on the last day | High |

Recommendation: (a). Chat already runs on the Agents SDK and `/chat` in FastAPI. The only new code is the event-to-UI-chunk mapper and an approve/discard resume route. Do not switch frameworks before the freeze.

## Do not use

| Item | Reason |
|---|---|
| langchain-ai/agent-chat-ui | Next.js app, needs a LangGraph server, no confirmed approval UI |
| vercel/ai-elements | Slated for deprecation end of Nov 2026; assumes Next.js |
| OpenAI ChatKit widget | Closed hosted widget; not restylable into our shadcn UI (unverified) |
| CopilotKit as a second chat UI | Duplicates assistant-ui; Agents SDK not a listed backend |
| `gemilive` as a dependency | v0.1.1, one month old, voice-chat oriented; copy ideas only |
| `greathayat/google-gemini-live` | Unreviewed license and audio path |
| Browser-direct Gemini with the long-lived key | Key exposure; use the relay (or an ephemeral token) |
| Any code without a verified LICENSE file | Public MIT repo rule |

## Sources

- https://github.com/assistant-ui/assistant-ui , https://api.github.com/repos/assistant-ui/assistant-ui/contents/examples
- https://www.assistant-ui.com/docs/guides/dictation
- https://www.assistant-ui.com/docs/runtimes/langgraph/tutorial/part-3
- https://www.assistant-ui.com/docs/runtimes/langgraph/interrupts , https://www.assistant-ui.com/docs/runtimes/langgraph/overview
- https://pypi.org/project/assistant-stream/
- https://github.com/google-gemini/live-api-web-console , https://api.github.com/repos/google-gemini/live-api-web-console/git/trees/main?recursive=1
- https://github.com/google-gemini/cookbook
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- https://pypi.org/project/gemilive/ , https://google.github.io/adk-docs/streaming/custom-streaming-ws
- https://github.com/openai/openai-agents-python/tree/main/examples/agent_patterns
- https://github.com/vercel/ai-elements , https://github.com/vercel/ai , https://github.com/ibelick/prompt-kit
- https://github.com/CopilotKit/CopilotKit , https://docs.copilotkit.ai/
- https://github.com/langchain-ai/agent-chat-ui , https://github.com/langchain-ai/langgraph
- https://pypi.org/project/vercel-ai-sdk , https://docs.ag-ui.com/quickstart/server.md
- https://github.com/twilio/twilio-python , https://github.com/twilio-samples/speech-assistant-openai-realtime-api-python , https://www.twilio.com/docs/voice/tutorials/how-to-record-phone-calls-python
- https://github.com/pacocoursey/cmdk , https://github.com/origin-space/originui , https://ui.shadcn.com/docs/components/calendar , https://ui.shadcn.com/charts/radial
