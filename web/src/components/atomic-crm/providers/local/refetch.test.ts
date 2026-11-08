import { scopesForTool } from "./refetch";

describe("agent write scopes", () => {
  it("refreshes tasks and the calendar after a merge or dismiss: the task generator retires and creates tasks", () => {
    for (const tool of ["merge_duplicate", "dismiss_duplicate"]) {
      expect(scopesForTool(tool)).toEqual(expect.arrayContaining(["tasks", "calendar", "people", "summary"]));
    }
  });
});
