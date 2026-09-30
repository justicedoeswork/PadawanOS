# Reviewed call-task ownership corrections

The existing `/api/communications` bridge stays GET-only. An optional, separate
`/api/call-followup-owner` router can update **only `responsibleParty`** on open
ledger items whose immutable `createdBy` is `call-commitments`.

## Behavior

Call follow-ups are grouped by source call ID, with numbered task references.
Grouping does not merge or delete ledger records. Source quotes stay in evidence.
A response such as “I am getting both prices for Taylor” can propose ownership
for the displayed tasks. Padawan shows the exact selected tasks and owner before
saving. The owner says “save correction” to apply, or “cancel correction”.
Generic “yes” never saves. Any intervening turn clears the pending review. Reload
or logout discards it. Saved corrections remain in the Communications ledger.

A ten-minute HMAC review binds IDs, titles, source IDs, versions and proposed
owner to the authenticated session. Confirmation re-reads every target, then uses
the upstream ledger's expectedVersion compare-and-swap and append-only history.
A batch is not atomic: partial/uncertain outcomes identify only confirmed saved
items and tell the user to reload. A retry of the same reviewed version/owner
is recognized without another update. It cannot silently overwrite later edits.
No generic PATCH proxy, approval, email send, deadline edit, status change or
transcript change is exposed. Ownership is a user correction, not voice identity.
Beneficiaries and the original clarification item type remain unchanged.

## Enable after review

Existing reads work without the new credential. Saving corrections is disabled
until `COMMUNICATIONS_OWNER_WRITE_KEY` is configured in the gateway. This is the
existing upstream `COMMUNICATIONS_API_WRITE_KEY` (not its approval or intake key).
It has broader upstream scope; the gateway restricts its use to the owner field.
It is never returned to the browser or given to the language interpreter.

From a checkout of the reviewed revision, on the owner's authenticated Windows PC:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy\configure-call-owner-updates.ps1
```

The script captures the credential from the authorized Communications Fly app
and stages it on `justiceos` using stdin bytes without a BOM, disk file or secret
command argument. It deliberately suppresses captured process output. This
transfer has not been run in automated tests. Deploy that same reviewed revision
with the normal Fly deployment procedure. Configure the allowed browser origin
as already required by the gateway. Both preview and confirm require a session,
a configured credential, JSON, and an explicitly allowed Origin.

Disable writes by removing `COMMUNICATIONS_OWNER_WRITE_KEY` from the gateway;
reads and saved ledger ownership remain available. If the upstream write key is
rotated, stage the new value on the gateway and redeploy as well.

## Verification

Ask for call follow-ups, give an explicit ownership correction, inspect the
preview and save. Ask again in a fresh chat session: the recorded owner should
remain, with no repeated ownership question for that task. Inspect the ledger
history for the owner change and review reason. No outbound message is produced.
Automated tests exercise the route with an in-memory upstream and cover session/
origin rejection, stale/expired/forged reviews, retry, partial failure reporting,
source grouping, frontend preview selection, and no save without a current review.
