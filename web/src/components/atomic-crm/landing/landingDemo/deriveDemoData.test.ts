import snapshot from "../../../../../public/snapshot.json";
import { deriveDemoData } from "./deriveDemoData";

// The landing demo must show the same names and numbers as the app's own sample data (home/demo/scenarios.ts).
describe("deriveDemoData (web/public/snapshot.json)", () => {
  const data = deriveDemoData(snapshot);

  it("carries every donor, duplicate pair, task and event", () => {
    expect(data.donors).toHaveLength(snapshot.donors.length);
    expect(data.dups).toHaveLength(snapshot.duplicates.length);
    expect(data.tasks).toHaveLength(snapshot.tasks_today.length);
    expect(data.events).toHaveLength(snapshot.events.length);
    expect(data.ask).toHaveLength(snapshot.ask_examples.length);
    expect(data.peopleTotal).toBe(
      snapshot.people.counts.giver + snapshot.people.counts.neighbor + snapshot.people.counts.community,
    );
  });

  it("builds the four Try-the-agent runs with the app's numbers", () => {
    expect(data.scripts.map((s) => s.id)).toEqual(["lookup", "catch_up", "batch_email", "call"]);
    const catchUp = data.scripts[1].card as any;
    expect(catchUp.name).toBe("Hye-jin Park");
    expect(catchUp.gifts).toBe(7);
    expect(catchUp.total).toBe(480);
    expect(catchUp.declined[0]).toEqual({ date: "Oct 10", amount: 40, status: "declined" });
    const batch = data.scripts[2] as any;
    expect(batch.card.count).toBe(4);
    expect(batch.approval.preview).toHaveLength(4);
    expect(batch.approval.approved.summary).toBe("Queued 4 emails (sample: nothing was sent)");
    expect((data.scripts[3] as any).call.lines).toHaveLength(8);
  });

  it("answers Show me with the gifts that look late, as many as Home counts", () => {
    expect(data.lateAnswer).toHaveLength(snapshot.home_summary.gifts_at_risk);
    expect(data.lateAnswer[0].name).toBe("Hye-jin Park");
  });

  it("refuses a file that isn't a snapshot", () => {
    expect(() => deriveDemoData({ files: [] })).toThrow();
  });
});
