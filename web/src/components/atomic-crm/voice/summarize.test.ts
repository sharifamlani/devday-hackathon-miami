import { describe, expect, it } from "vitest";

import type { TranscriptLine } from "./callNotes";
import {
  buildSummary,
  defaultNoteTitle,
  findSpokenDate,
  formatElapsed,
  nextStepKind,
  nextStepPrompt,
  savedConfirmation,
  summarizeTranscript,
} from "./summarize";
import { demoCallScript } from "./transcriptSource";

const NOV_7 = new Date(2026, 10, 7); // Sat, Nov 7 2026

const demoTranscript = (donor = "Hye-jin Park"): TranscriptLine[] =>
  demoCallScript(donor).map((line, i) => ({
    speaker: line.speaker,
    name: line.speaker === "you" ? "You" : donor.split(" ")[0],
    text: line.text,
    at: i,
  }));

const line = (
  text: string,
  speaker: TranscriptLine["speaker"] = "them",
): TranscriptLine => ({
  speaker,
  name: speaker === "you" ? "You" : "Ana",
  text,
  at: 0,
});

describe("summarizeTranscript", () => {
  it("summarizes the demo call into key points and next steps", () => {
    const result = summarizeTranscript({
      transcript: demoTranscript(),
      donorName: "Hye-jin Park",
      today: NOV_7,
    });
    expect(result.summary).toEqual([
      "Hye-jin's card changed; they'll update it from a secure link.",
      "Signed up for the Give Miami 5K on Sun, Nov 15.",
    ]);
    expect(result.nextSteps).toEqual([
      "Send card-update link",
      "Add Nov 15 to calendar",
    ]);
  });

  it("is deterministic", () => {
    const input = {
      transcript: demoTranscript(),
      donorName: "Rosa Delgado",
      today: NOV_7,
    };
    expect(summarizeTranscript(input)).toEqual(summarizeTranscript(input));
  });

  it("reads every line when the mic gave no speaker labels", () => {
    const result = summarizeTranscript({
      transcript: [
        line("Her new card needs an update, I'll text a link.", "you"),
        line("She's coming to the gala on December 3rd.", "you"),
      ],
      donorName: null,
      today: NOV_7,
    });
    expect(result.summary).toEqual([
      "The donor's card changed; they'll update it from a secure link.",
      "Signed up for the gala on Thu, Dec 3.",
    ]);
    expect(result.nextSteps).toEqual([
      "Send card-update link",
      "Add Dec 3 to calendar",
    ]);
  });

  it("flags a failed gift without an update plan", () => {
    const result = summarizeTranscript({
      transcript: [line("My payment failed last week, sorry.")],
      donorName: "Ana Ruiz",
      today: NOV_7,
    });
    expect(result.summary).toEqual(["Ana's last card gift didn't go through."]);
    expect(result.nextSteps).toEqual(["Send card-update link"]);
  });

  it("mentions an event without a date but adds no calendar step", () => {
    const result = summarizeTranscript({
      transcript: [line("I'd love to hear more about the spring gala.")],
      donorName: "Ana Ruiz",
      today: NOV_7,
    });
    expect(result.summary).toEqual(["Interested in the spring gala."]);
    expect(result.nextSteps).toEqual(["Plan a follow-up"]);
  });

  it("falls back to a plain point when nothing matches", () => {
    expect(
      summarizeTranscript({
        transcript: [line("Thanks, have a good night.")],
        donorName: "Ana Ruiz",
        today: NOV_7,
      }),
    ).toEqual({
      summary: ["Talked with Ana; no gift or event details came up."],
      nextSteps: ["Plan a follow-up"],
    });
    expect(
      summarizeTranscript({ transcript: [], donorName: null, today: NOV_7 }),
    ).toEqual({ summary: ["Nothing was transcribed."], nextSteps: [] });
  });
});

describe("buildSummary", () => {
  it("returns the rules result for now", async () => {
    const input = {
      transcript: demoTranscript(),
      donorName: "Rosa Delgado",
      notes: "",
      today: NOV_7,
    };
    await expect(buildSummary(input)).resolves.toEqual({
      ...summarizeTranscript(input),
      source: "rules",
    });
  });
});

describe("findSpokenDate", () => {
  it("resolves 'the 21st' to the next 21st", () => {
    expect(findSpokenDate("on the 21st", NOV_7)).toEqual(
      new Date(2026, 10, 21),
    );
    expect(findSpokenDate("on the 3rd", NOV_7)).toEqual(new Date(2026, 11, 3));
    expect(findSpokenDate("on the 7th", NOV_7)).toEqual(new Date(2026, 10, 7));
  });

  it("skips months without that day", () => {
    expect(findSpokenDate("the 31st", new Date(2026, 10, 7))).toEqual(
      new Date(2026, 11, 31),
    );
  });

  it("reads month names and rolls past dates into next year", () => {
    expect(findSpokenDate("November 21st works", NOV_7)).toEqual(
      new Date(2026, 10, 21),
    );
    expect(findSpokenDate("see you Jan 5", NOV_7)).toEqual(
      new Date(2027, 0, 5),
    );
    expect(findSpokenDate("back on March 2", NOV_7)).toEqual(
      new Date(2027, 2, 2),
    );
  });

  it("returns null without a date or for impossible days", () => {
    expect(findSpokenDate("sometime soon", NOV_7)).toBeNull();
    expect(findSpokenDate("February 30", NOV_7)).toBeNull();
    expect(findSpokenDate("the 45th", NOV_7)).toBeNull();
  });
});

describe("formatting helpers", () => {
  it("formats the call clock", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(130)).toBe("2:10");
    expect(formatElapsed(3725)).toBe("1:02:05");
    expect(formatElapsed(-4)).toBe("0:00");
  });

  it("builds the default title", () => {
    expect(defaultNoteTitle("Rosa Delgado", NOV_7)).toBe(
      "Call with Rosa Delgado",
    );
    expect(defaultNoteTitle(null, NOV_7)).toBe("Call notes · Nov 7");
  });

  it("confirms where the note was saved", () => {
    expect(
      savedConfirmation([
        { kind: "donor", id: "1", label: "Rosa Delgado" },
        { kind: "project", id: "4", label: "Give Miami Day" },
      ]),
    ).toBe(
      "Saved to Rosa Delgado, Give Miami Day and added to your Donor Desk context.",
    );
    expect(savedConfirmation([])).toBe(
      "Added to your Donor Desk context. Pick a donor, group or project to file it.",
    );
  });

  it("picks next-step icons and Ask prompts", () => {
    expect(nextStepKind("Send card-update link")).toBe("send");
    expect(nextStepKind("Add Nov 21 to calendar")).toBe("calendar");
    expect(nextStepKind("Plan a follow-up")).toBe("other");
    expect(nextStepPrompt("Plan a follow-up", "Rosa Delgado")).toBe(
      "After my call with Rosa Delgado: Plan a follow-up. Help me do this.",
    );
    expect(nextStepPrompt("Plan a follow-up", null)).toBe(
      "After my call: Plan a follow-up. Help me do this.",
    );
  });
});
