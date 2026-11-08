import { scopesForTool } from "./refetch";

describe("agent write scopes", () => {
  it("refreshes tasks and the calendar after a merge or dismiss: the task generator retires and creates tasks", () => {
    for (const tool of ["merge_duplicate", "dismiss_duplicate"]) {
      expect(scopesForTool(tool)).toEqual(expect.arrayContaining(["tasks", "calendar", "people", "summary"]));
    }
  });

  it("refreshes Files & drafts after the agent drafts or sends, so a new campaign row shows without a reload", () => {
    for (const tool of ["draft_email", "draft_sms", "send"]) {
      expect(scopesForTool(tool)).toEqual(expect.arrayContaining(["campaigns", "artifacts"]));
    }
  });

  it("leaves Files & drafts alone for read-only tools", () => {
    expect(scopesForTool("find_people")).toBeUndefined();
  });
});
