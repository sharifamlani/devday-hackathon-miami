/**
 * One definition of "home" (docs/plans/user-journey.md §3). The dashboard has its own URL, #/dashboard;
 * react-admin's own home route "/" redirects there, so "/" (and "" before the router settles) still count
 * as home while that redirect runs, and every existing navigate("/") keeps landing on the dashboard.
 */
export const HOME = "/dashboard";

export const isHomePath = (pathname: string) =>
  pathname === HOME || pathname === "/" || pathname === "";
