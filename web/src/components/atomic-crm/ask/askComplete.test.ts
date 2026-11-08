import { EXAMPLE_QUESTIONS } from "../providers/local/ask";
import { completionFor } from "./askComplete";

describe("completionFor (Tab autocomplete)", () => {
  it("completes a case-insensitive prefix with ghost text", () => {
    expect(completionFor("monthly d")).toEqual({
      question: "Monthly donors whose last gift is late",
      suffix: "onors whose last gift is late",
    });
    expect(completionFor("BIG")).toEqual({
      question: EXAMPLE_QUESTIONS[3],
      suffix: EXAMPLE_QUESTIONS[3].slice(3),
    });
  });

  it("treats curly and straight apostrophes alike", () => {
    expect(completionFor("Who needs outreach because they’ve")?.question).toBe(
      EXAMPLE_QUESTIONS[1],
    );
  });

  it("falls back to a word match, without inline ghost text", () => {
    expect(completionFor("gone quiet")).toEqual({
      question: EXAMPLE_QUESTIONS[1],
      suffix: null,
    });
    expect(completionFor("haven't called")?.question).toBe(
      EXAMPLE_QUESTIONS[3],
    );
  });

  it("suggests nothing for short, multi-line, finished or unmatched text", () => {
    expect(completionFor("")).toBeNull();
    expect(completionFor("wh")).toBeNull();
    expect(completionFor("Who\nhelped")).toBeNull();
    expect(completionFor(` ${EXAMPLE_QUESTIONS[2].toUpperCase()} `)).toBeNull();
    expect(completionFor("Give Miami Day 2024 donors")).toBeNull();
  });
});
