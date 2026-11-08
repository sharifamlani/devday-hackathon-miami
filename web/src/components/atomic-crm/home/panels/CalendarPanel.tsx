import { CalendarV3 } from "../calendar/CalendarV3";

/** Calendar v3 (organization events only) hosted in the Home zoom panel. */
export const CalendarPanel = () => (
  <div className="desk-calendar-panel p-4">
    <CalendarV3 />
  </div>
);
