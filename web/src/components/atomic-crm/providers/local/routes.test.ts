import { routeExists, toRouteTable } from "./routes";

// A trimmed /openapi.json "paths" from the running service.
const table = toRouteTable({
  "/donors": { get: {} },
  "/donors/{donor_id}": { get: {} },
  "/drafts/{draft_id}/approve": { post: {} },
  "/context/run": { post: {} },
});

describe("routeExists", () => {
  it("matches templated segments and the method", () => {
    expect(routeExists(table, "GET", "/donors")).toBe(true);
    expect(routeExists(table, "GET", "/donors/12")).toBe(true);
    expect(routeExists(table, "POST", "/drafts/5/approve")).toBe(true);
    expect(routeExists(table, "GET", "/context/run")).toBe(false); // wrong method
  });

  it("ignores the query string and rejects unserved or deeper paths", () => {
    expect(routeExists(table, "GET", "/donors?x=1")).toBe(true);
    expect(routeExists(table, "GET", "/people?type=giver")).toBe(false);
    expect(routeExists(table, "GET", "/donors/12/gifts")).toBe(false);
    expect(routeExists(table, "POST", "/events/3/plan")).toBe(false);
  });
});
