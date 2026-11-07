# Gemma 4 via the Gemini API — verified 2026-10-10

**Smoke S4: PASS.** Key authenticates, Gemma 4 is reachable, and a real completion came back.
This is the gate on **Challenge 2 (Best Open-Source AI Project)** and **Challenge 3 (Best Use of
Gemma 4)**, so it is verified rather than assumed.

## What the key can reach

| | |
|---|---|
| Auth | ✅ HTTP 200, **62 models visible** |
| **Gemma 4 models** | **`gemma-4-31b-it`** · **`gemma-4-26b-a4b-it`** |
| Real completion | ✅ HTTP 200, `finishReason: STOP`, correct answer returned |

Endpoint shape (key goes in the header, never the URL — URLs leak into logs and shell history):

```
POST https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent
Header: x-goog-api-key: $GEMINI_API_KEY
Body:   {"contents":[{"parts":[{"text":"..."}]}],"generationConfig":{"maxOutputTokens":1024}}
```

---

## 🚨 Trap 1: the default model in `.env` forfeits both challenges

`.env` currently carries:

```
GOOGLE_MODEL       = gemini-3.1-pro-preview
GOOGLE_PRO_MODEL   = gemini-3.1-pro-preview
GOOGLE_FLASH_MODEL = gemini-3.1-flash-preview
GOOGLE_IMAGE_MODEL = gemini-3.1-pro-image-preview
```

**Gemini 3.1 is closed-weight. Gemma 4 is open-weight. Only Gemma 4 qualifies.**

If the app reads `GOOGLE_MODEL` — the obvious thing to do, and what the other projects on this
machine do — then everything works, the demo runs beautifully, and **Challenge 2 and Challenge 3
are silently forfeited.** Nothing fails. There is no error. You just don't win two of the three
prizes you were eligible for.

This is the same shape of failure as the stale district layer: correct-looking and wrong.

**Fix:** a dedicated variable, and the product code reads *only* that one.

```
GEMMA_MODEL=gemma-4-31b-it
```

Add it to `.env` (one line — `.env.example` already carries the template). Then in the README,
name `gemma-4-31b-it` explicitly, because Challenge 3 requires the model named in the README and
the integration shown in the code and the demo.

> Gemini 3.1 is still fine for anything *not* being judged on open weights. But the model doing
> the work the judges look at must be Gemma 4.

---

## 🚨 Trap 2: Gemma 4 is a thinking model, and the reasoning is a separate part

A `generateContent` response carries **two** parts:

```json
"parts": [
  { "text": "The user wants me to reply with a specific string...", "thought": true },
  { "text": "SMOKE S4 PASS" }
]
```

`parts[0]` is the model's **internal reasoning**, flagged `thought: true`. `parts[1]` is the
actual answer.

**The naive join renders the model's internal monologue on screen:**

```js
// WRONG — puts the reasoning in front of the judges
const out = data.candidates[0].content.parts.map(p => p.text).join("");

// RIGHT — verified to return exactly "SMOKE S4 PASS"
const out = data.candidates[0].content.parts
  .filter(p => !p.thought)
  .map(p => p.text)
  .join("");
```

**Thinking cannot be turned off.** `generationConfig.thinkingConfig.thinkingBudget: 0` returns:

```
HTTP 400  "Thinking budget is not supported for this model."
```

Verified on **both** Gemma 4 variants. So **filtering is mandatory, not a preference.**

### Budget tokens for the thinking, not just the answer

Measured on a trivial prompt:

| | tokens |
|---|---|
| prompt | 9 |
| **thoughts** | **52** |
| answer | 5 |
| total | 77 |

The reasoning cost **10× the answer**. If `maxOutputTokens` is set tight for a short reply, the
thinking consumes the budget and you get an **empty answer with `finishReason: MAX_TOKENS`** —
which looks exactly like a broken integration. Give it room: 1024+ for anything real, and always
check `finishReason` before rendering.

---

## Checklist before the demo

- [ ] `GEMMA_MODEL=gemma-4-31b-it` in `.env`, and the product code reads **that** variable
- [ ] No code path falls back to `GOOGLE_MODEL` / `gemini-*` for the judged work
- [ ] Response parsing filters `p.thought` — confirm no reasoning text reaches the screen
- [ ] `maxOutputTokens` ≥ 1024; `finishReason` checked before render
- [ ] README names `gemma-4-31b-it` and links Gemma's license/terms (Challenge 2 requirement)
- [ ] The demo *shows* the Gemma 4 integration (Challenge 3 requirement)
- [ ] Claude Code disclosed separately as a coding agent, not as a model in the product

## Reproduce

```bash
# auth + model list (key in header, not URL)
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200" \
  | python -c "import sys,json;print([m['name'] for m in json.load(sys.stdin)['models'] if 'gemma' in m['name']])"

# a real completion
curl -s -X POST -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Reply with exactly: SMOKE S4 PASS"}]}],"generationConfig":{"maxOutputTokens":500}}' \
  "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent"
```
