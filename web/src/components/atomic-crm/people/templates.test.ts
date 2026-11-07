import type { Person } from "../providers/local/crmTypes";
import { ASK_WORDS, communityCheckIn, neighborFollowUp } from "./templates";

const person = (over: Partial<Person> = {}): Person => ({
  id: 1,
  name: "Rosa Pérez",
  org_name: null,
  tab: "community",
  email: null,
  phone: null,
  city: null,
  tags: [],
  has_dog: null,
  demographics: [{ label: "Programs", value: "Arts Access, Zero Drownings" }],
  is_sample: false,
  score: null,
  tier: null,
  is_star: false,
  status: null,
  last_touch: null,
  next_step: null,
  needs_review: false,
  review_reason: null,
  ...over,
});

describe("Community check-in template (plan.md §17 copy rule)", () => {
  it("never contains a donation ask", () => {
    for (const p of [person(), person({ demographics: [{ label: "Programs", value: "not recorded" }] })]) {
      const text = communityCheckIn(p, "The Miami Foundation");
      expect(text).not.toMatch(ASK_WORDS);
    }
  });

  it("asks about the first recorded program, and falls back when none is recorded", () => {
    expect(communityCheckIn(person(), "The Miami Foundation")).toContain("How is Arts Access going for you?");
    expect(
      communityCheckIn(person({ demographics: [{ label: "Programs", value: "not recorded" }] }), "The Miami Foundation"),
    ).toContain("How are things going?");
  });

  it("the ask-word check catches the obvious asks", () => {
    for (const ask of ["Please donate today", "Your gift matters", "Give Miami Day", "$50 helps", "support us"]) {
      expect(ask).toMatch(ASK_WORDS);
    }
  });
});

describe("Neighbor follow-up template", () => {
  it("mentions a recorded interest and has no ask", () => {
    const text = neighborFollowUp(person({ tab: "neighbor", tags: ["dogs"] }), "The Miami Foundation");
    expect(text).toContain("given your interest in dogs");
    expect(text).not.toMatch(ASK_WORDS);
  });
});
