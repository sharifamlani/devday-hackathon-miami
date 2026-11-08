# Donor Desk dashboard reference

`index.html` is the standalone design prototype approved in the design review.
Open it directly or serve this directory. Its donor names, numbers, chat replies,
and actions are illustrative; changes reset on reload.

The connected app implementation lives in `web/src/components/atomic-crm/home/`.
It uses the existing data hooks and app actions rather than the mock data here.

Final direction: white canvas, borderless frosted tiles with centered yellow,
Q4 semicircle with the percentage underneath, calendar/tasks/files stacked on the
left, compact collapsible task groups, task details on demand, rounded pale-yellow
messages, and a white composer with a yellow/green bloom only when Send is activated.
Upper navigation, theme toggle, reached-today text, summary/CRM tiles, central task
card, and the earlier-conversation label are absent from the dashboard.
