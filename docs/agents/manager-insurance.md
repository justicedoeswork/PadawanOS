# Manager insurance reads

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

PDF generation, operator email and renewal approval actions are not enabled by
this read integration. The interpreter must report those requests as unsupported
until authenticated scoped action workflows exist. Never enable unrestricted ACP
to make them work. Mixed read/write requests must not silently drop the action.

Deployment uses the existing ACP and manager language configuration. No new
credential or public insurance service endpoint is introduced.
