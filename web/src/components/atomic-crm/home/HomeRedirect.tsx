import { Navigate, useLocation } from "react-router";

import { HOME } from "./homePath";

/** react-admin's home route ("/"): the dashboard has its own URL, #/dashboard; the query comes along. */
export const HomeRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={{ pathname: HOME, search }} replace />;
};
