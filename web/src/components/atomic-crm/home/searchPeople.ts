import type { Person } from "../providers/local/crmTypes";

/** Neighbors and Community people whose name, email, organization or city has every typed word. */
export const searchPeople = (people: Person[], query: string, limit = 8) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return people
    .filter((p) => {
      const hay = [p.name, p.email, p.org_name, p.city]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
};
