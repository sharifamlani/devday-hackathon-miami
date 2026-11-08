/**
 * POST /api/ask — Vercel Function for the hosted Donor Desk (snapshot mode).
 *
 * One read-only OpenAI Agents SDK run per new question: no tools, no
 * handoffs, structured AskPlan output. The guard, schema and prompt live in
 * ./_askCore.ts (tested without network). Without OPENAI_API_KEY it answers
 * 503 {error: "not_configured"} and the site keeps its precomputed examples.
 *
 * Env (Vercel → Settings → Environment Variables): OPENAI_API_KEY (Sensitive),
 * optional OPENAI_MODEL_FAST, else OPENAI_MODEL_DEFAULT, else the SDK default.
 * Also set VITE_ASK_API=on (build-time): without it the site never calls this function.
 */
import {
  AnswerCache,
  AskPlanSchema,
  MAX_OUTPUT_TOKENS,
  RateLimiter,
  handleAsk,
  type PlanRunner,
} from "./_askCore.js";

declare const process: { env: Record<string, string | undefined> };

// Per function instance (Fluid compute reuses warm instances); the OpenAI
// project's own spend limit is the hard cap.
const perIp = new RateLimiter(20, 10 * 60_000);
const allClients = new RateLimiter(300, 60 * 60_000);
const cache = new AnswerCache(500);

const runPlan: PlanRunner = async ({
  question,
  asOf,
  model,
  instructions,
  signal,
}) => {
  const { Agent, run, withTrace, getGlobalTraceProvider, setDefaultOpenAIKey } =
    await import("@openai/agents");
  setDefaultOpenAIKey(process.env.OPENAI_API_KEY!);
  // No tools and no handoffs: the agent can only answer with an AskPlan.
  const agent = new Agent({
    name: "AskDonorDesk",
    instructions,
    model,
    outputType: AskPlanSchema,
    modelSettings: { maxTokens: MAX_OUTPUT_TOKENS },
  });
  const result = await withTrace(
    "Ask Donor Desk (hosted)",
    async (trace) => {
      const output = await run(agent, question, { signal, maxTurns: 1 });
      return { output: output.finalOutput, traceId: trace.traceId };
    },
    { metadata: { as_of: asOf } },
  );
  // Serverless: send the trace before the instance can freeze. Best effort.
  await getGlobalTraceProvider()
    .forceFlush()
    .catch(() => {});
  return result;
};

export async function POST(request: Request): Promise<Response> {
  return handleAsk(request, {
    env: process.env,
    runPlan,
    perIp,
    global: allClients,
    cache,
    log: (message) => console.warn(message),
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleAsk(request, { env: {}, runPlan });
}
