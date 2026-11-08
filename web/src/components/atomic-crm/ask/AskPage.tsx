import { AskPanel } from "./AskPanel";

/**
 * /ask: the full-page Ask Donor Desk (issue #36). The same session also
 * powers the Ask sidebar (AskSidebar.tsx), so a question asked there is
 * still here.
 */
export const AskPage = () => <AskPanel variant="page" />;
