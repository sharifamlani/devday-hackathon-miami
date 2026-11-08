# Donor Desk dashboard reference

`index.html` is the latest standalone mockup from the design review. Its donor names, figures, responses, and calendar event times are illustrative. Open it directly or serve this directory; changes reset on reload.

The connected React implementation lives in `web/src/components/atomic-crm/home/`. It keeps the current service integration and reads actual calendar, task, campaign, and target data. Events without times appear in the all-day row. Nearby timed events share a block that opens their complete details.

The overview stacks Q4, calendar, tasks, Projects, and files. A neutral toggle beside Q4 hides or restores the entire column, while voice, Ask, and account controls remain at the bottom left. The rail is 40px wide. The Q4 percentage nests inside its arch; the home wordmark, date, meeting-notes button, summary tile, and CRM tile are absent.

`reference.png` shows the latest approved mockup. `implemented.png` and `mobile.png` show the React app with its existing labeled sample data. The React calendar uses the current service week, rather than the standalone mockup’s fixed sample dates.
