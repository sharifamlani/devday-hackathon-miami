import { useOrgProfile } from "../providers/local/hooks";

/** Shown until the org profile loads, or when none is saved yet: the demo's fictional persona
 *  (service/personas/tidepath; the service's org_config.json "persona" picks the org). */
export const DEFAULT_ORG_NAME = "Tidepath";

/** The demo org's name from the saved org profile (GET /org-profile, or the snapshot's context). */
export const useOrgName = () => useOrgProfile().data?.name || DEFAULT_ORG_NAME;
