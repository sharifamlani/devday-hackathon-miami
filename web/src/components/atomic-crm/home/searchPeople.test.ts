import type { Person, Tab } from "../providers/local/crmTypes";
import { searchPeople } from "./searchPeople";

const person = (
  id: number,
  name: string,
  tab: Tab,
  extra: Partial<Person> = {},
): Person => ({
  id,
  name,
  tab,
  org_name: null,
  email: null,
  phone: null,
  city: null,
  tags: [],
  has_dog: null,
  demographics: [],
  is_sample: false,
  score: null,
  tier: null,
  is_star: false,
  status: null,
  last_touch: null,
  next_step: null,
  needs_review: false,
  review_reason: null,
  notes: null,
  source: null,
  auto_merged: false,
  merged_from: 0,
  ...extra,
});

const people = [
  person(63, "Anil Deshmukh", "neighbor", {
    email: "anil.deshmukh@example.org",
  }),
  person(15, "Gabriela Rincon", "neighbor", { city: "Miami" }),
  person(31, "Altagracia Pena", "community", { city: "Hialeah" }),
];

describe("Find a donor: Neighbors and Community", () => {
  it("matches every typed word against name, email, organization and city", () => {
    expect(searchPeople(people, "anil").map((p) => p.id)).toEqual([63]);
    expect(searchPeople(people, "example.org").map((p) => p.id)).toEqual([63]);
    expect(searchPeople(people, "gabriela miami").map((p) => p.id)).toEqual([
      15,
    ]);
    expect(searchPeople(people, "pena hialeah")[0].tab).toBe("community");
  });

  it("returns nothing for an empty query (the dialog then lists top givers only)", () => {
    expect(searchPeople(people, "  ")).toEqual([]);
  });
});
