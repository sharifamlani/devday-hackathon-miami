import { useEffect, useState } from "react";

import { DATA_MODE, donorDeskMethods } from "../providers/local";

/**
 * Live mode: does the service already have people? null while asking, and when the service can't be
 * reached (unknown is not empty: callers never send a filled app to the landing on a blip). Setup is remembered only in this
 * browser's localStorage, so a new browser (or incognito) on a filled service would otherwise get
 * step 1 over a working dashboard. Snapshot mode: always false, so nothing changes there.
 */
export const useServiceHasPeople = (): boolean | null => {
  const [hasPeople, setHasPeople] = useState<boolean | null>(
    DATA_MODE === "local" ? null : false,
  );
  useEffect(() => {
    if (DATA_MODE !== "local") return;
    let live = true;
    donorDeskMethods
      .getDonors()
      .then((donors) => live && setHasPeople(donors.length > 0))
      .catch(() => live && setHasPeople(null));
    return () => {
      live = false;
    };
  }, []);
  return hasPeople;
};
