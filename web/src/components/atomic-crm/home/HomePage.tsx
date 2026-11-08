import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ArrowLeft, X } from "lucide-react";
import { ImportDonorsDialog } from "../import/ImportDonorsDialog";
import { useOrgProfile } from "../providers/local/hooks";
import { useHomeSummary } from "../providers/local/homeSummary";
import { DonorList } from "../contacts/DonorList";
import { OrganizationList } from "../companies/OrganizationList";
import { CalendarPage } from "../calendar/CalendarPage";
import { AgentThread, Composer } from "./HomeChat";
import { firstName, greeting } from "./homeData";
import "./dashboard.css";
import "./workspace.css";

export const HomePage = () => {
  const [params] = useSearchParams();
  const view = params.get("workspace");
  const panel =
    view === "donors" || view === "organizations" || view === "calendar"
      ? view
      : null;
  const profile = useOrgProfile();
  const summary = useHomeSummary();
  const name = firstName(
    (profile.data as { staff_name?: string | null } | null)?.staff_name,
  );
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="home-design desk-home">
      <section
        aria-label="Agent"
        data-tour="chat"
        className="home-conversation"
        hidden={!!panel}
      >
        <div className="home-greeting">
          <h1 className="mb-3.5 text-[28px] leading-tight font-normal tracking-[-0.02em]">
            {greeting(new Date().getHours())}
            {name ? `, ${name}.` : "."}
          </h1>
        </div>
        <AgentThread />
        <Composer
          onUploadList={() => setImportOpen(true)}
          suggestions={
            summary.data?.suggestions?.length
              ? summary.data.suggestions
              : undefined
          }
        />
      </section>
      {panel && (
        <section
          className="desk-main-panel"
          aria-label={
            panel === "calendar"
              ? "Calendar workspace"
              : "Donor directory workspace"
          }
        >
          <div className="desk-panel-toolbar">
            <Link to="/">
              <ArrowLeft size={16} /> Back to chat
            </Link>
            <Link to="/" aria-label="Close workspace panel">
              <X size={18} />
            </Link>
          </div>
          {panel === "donors" ? (
            <DonorList embedded />
          ) : panel === "organizations" ? (
            <OrganizationList embedded />
          ) : (
            <CalendarPage />
          )}
        </section>
      )}
      <ImportDonorsDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
};
