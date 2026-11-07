import { useQuery } from "@tanstack/react-query";

import { DATA_MODE } from "../providers/local/config";
import { knownRoutes, routeExists } from "../providers/local/routes";

/**
 * Does the running API build serve this route? Screens check it first and
 * show a "not available yet" state instead of firing a call that fails (a
 * failed call is logged to the console in dev builds). Snapshot mode always
 * answers yes: the snapshot client handles every method itself.
 * `undefined` while the route table is loading.
 */
export const useServes = (method: string, path: string): boolean | undefined => {
  const routes = useQuery({
    queryKey: ["donor-desk", "routes"],
    queryFn: knownRoutes,
    staleTime: Infinity,
    enabled: DATA_MODE === "local",
  });
  if (DATA_MODE !== "local") return true;
  if (routes.isPending) return undefined;
  // An unreadable table means "assume it exists", like request() does.
  return routes.data ? routeExists(routes.data, method, path) : true;
};
