# Manager insurance reads and reports

The language interpreter now recognizes insurance questions as a bounded read
intent. Its question preserves the contractor, coverage and relevant dates.
The browser validates that intent and uses the existing same-origin
`/acp/insurance` connection. The gateway still supplies trusted user/realm
identity and credentials; the model cannot select an endpoint or tenant.

Each read initializes a short-lived ACP session, asks the question, collects
only that session's answer and closes the socket. No client capabilities are
offered. Unexpected server requests are refused. Disconnects, timeouts and
malformed/oversized responses fail without automatic replay or presenting an
unfinished answer as complete. The insurance service's existing read-only
operation mode remains enforced.

Coverage on file and COI compliance are distinct. Insurance evidence, including
limits and unmet requirements, comes from the insurance agent. Historical audit
questions use the requested historical dates; no audit is regenerated.

Reports use a separate `report` language action and `/api/insurance/report`
gateway route. They never enter the ACP read tool loop. The only supported
write operation creates a current contractor insurance PDF and optionally
emails that newly generated file to the configured operator. Filters are a
literal contractor name and active-vendor status; active vendors do not imply
active policies. The report includes WC/GL policy details, dates, limits, and
separate coverage/compliance findings. It does not regenerate the annual audit.

The route requires a signed session, an allowed Origin and JSON. The server
derives its fixed private endpoint and supplies the existing service credential
and user/company context. Neither the model nor browser can supply a recipient,
attachment ID, URL, tool, email body or subject. Producer emails and renewal
approvals remain unsupported through this report action. Unrestricted ACP stays
disabled. Other mixed read/write requests must not silently drop the action.

Before posting, the browser retains the UUID and exact request in sessionStorage.
On uncertainty it keeps that ID. “Check report status” bypasses interpretation
and uses the separate `/api/insurance/report/status` read-only route. If the
original request never arrived, status returns `not_started` without claiming
or starting work. It reads the same durable backend request; repeated requests do not
regenerate the PDF or resend email. An ordinary repeat/explain also cannot
execute the action again. Interrupted backend tasks stay held for review.
The response distinguishes the saved PDF, Outlook acceptance, partial completion
and an uncertain delivery outcome. It never claims recipient delivery merely
because Outlook accepted the message.

Deployment uses the existing ACP and manager language configuration. No new
credential or public insurance service endpoint is introduced.
Deploy the insurance backend's report endpoint and apply its
`20261001011034_add_manager_report_requests` migration before deploying this
gateway/UI change. Missing upstream support fails closed. This code change does
not send a report automatically or enable producer outreach or schedules.
