import snapshotJson from "../../../../../public/snapshot.json";
import { applyMotionPreference } from "@/lib/motion";
import { decideDemo, followUpDemo, getDemoState, playDemo, resetDemoRuns, visibleSteps } from "./demoRun";

const load = async () => snapshotJson;
const lastRun = () => getDemoState().runs.at(-1)!;

describe("demoRun", () => {
  beforeEach(() => {
    resetDemoRuns();
    applyMotionPreference("full");
  });
  afterEach(() => applyMotionPreference("system"));

  it("shows each step running, then done, in order, and the cards only at the end", async () => {
    const frames: string[] = [];
    const playing = playDemo("catch_up", "Get me up to speed on Hye-jin Park", { stepMs: 15, load });
    expect(getDemoState().playing).toBe(true);
    // Sample the store while it plays: each frame is "status,status,…|done".
    const sample = setInterval(() => {
      const run = lastRun();
      frames.push(`${visibleSteps(run).map((s) => s.status).join(",")}|${run.done}`);
    }, 3);
    await playing;
    clearInterval(sample);
    const end = lastRun();
    frames.push(`${visibleSteps(end).map((s) => s.status).join(",")}|${end.done}`);

    const order = [
      "running|false",
      "done,running|false",
      "done,done,running|false",
      "done,done,done|false",
      "done,done,done|true",
    ];
    const distinct = frames.filter((f, i) => f !== frames[i - 1] && f !== "|false");
    // Every frame is one of the states above, and they only move forward.
    const idx = distinct.map((f) => order.indexOf(f));
    expect(idx.every((n) => n >= 0)).toBe(true);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(distinct[0]).toBe("running|false");
    expect(distinct).toContain("done,running|false");
    expect(distinct.at(-1)).toBe("done,done,done|true");
    expect(getDemoState().playing).toBe(false);
  });

  it("with reduced motion, shows the whole run at once", async () => {
    applyMotionPreference("reduce");
    await playDemo("call", "Call Rafael Quintero", { stepMs: 5000, load });
    const run = lastRun();
    expect(run.done).toBe(true);
    expect(visibleSteps(run).every((s) => s.status === "done")).toBe(true);
  });

  it("ignores a second click while a run is playing", async () => {
    const first = playDemo("lookup", "Look up Bernard Okoye", { stepMs: 10, load });
    await playDemo("call", "Call Rafael Quintero", { stepMs: 10, load });
    await first;
    expect(getDemoState().runs.map((r) => r.question)).toEqual(["Look up Bernard Okoye"]);
  });

  it("Send adds its outcome once; a follow-up is added once", async () => {
    await playDemo("batch_email", "Email", { stepMs: 0, load });
    const id = lastRun().id;
    decideDemo(id, true);
    decideDemo(id, false);
    expect(lastRun().decision).toBe(true);
    expect(lastRun().extra.map((s) => s.tool)).toEqual(["queue_emails"]);

    await playDemo("lookup", "Look up", { stepMs: 0, load });
    const lookup = lastRun().id;
    followUpDemo(lookup);
    followUpDemo(lookup);
    expect(lastRun().extra.map((s) => s.tool)).toEqual(["save_to_profile"]);
  });

  it("shows the error instead of hanging when the snapshot can't load", async () => {
    await playDemo("call", "Call", { stepMs: 0, load: () => Promise.reject(new Error("offline")) });
    expect(lastRun()).toMatchObject({ error: "offline", done: true, script: null });
    expect(getDemoState().playing).toBe(false);
  });
});
