# QuickBooks posted accounting connection

Finance reuses the existing Insurance Agent's production Intuit application and AES-256-GCM token vault. Client credentials and tokens remain in that service. Finance receives a separate runtime broker credential and posted data over Fly's private network. The broker pins one owner-authorized realm. CompanyInfo.Id is NOT assumed to be the realm.

The registered callback stays at Insurance. Finance-prefixed state redirects only to the fixed Padawan callback. Padawan requires its authenticated session and a Secure, HttpOnly, SameSite=Lax browser-binding cookie. Finance stores state and binding hashes with a ten-minute expiration, atomically consumes state before exchange, and never retries an authorization code. The broker rejects a different realm.

All existing QBO refresh/reconnect/disconnect paths share a database lease. The vault marks rotation uncertain before contacting Intuit. Successful fenced encrypted-token persistence clears uncertainty; crashes, failed persistence and ambiguous exchanges require reconnection. Intuit's accounting scope grants read/write authority. Application accounting traffic is GET-only, generated from an entity allowlist; OAuth token POSTs are allowed. No accounting create/update/delete, categorization, matching or posting is implemented.

## Import and review

Backfill begins 2025-10-01 and includes all accounts (including inactive accounts), Purchase (cash/check/card), Deposit, Transfer, JournalEntry, BillPayment, CreditCardPayment, Payment, SalesReceipt, RefundReceipt, Invoice, Bill, CreditMemo and VendorCredit. Original JSON, splits, links, categories, references and date-only posting dates are retained. The TransactionListWithSplits report is refreshed hourly. Report-only payroll/tax and other unsupported transaction types are imported with original IDs, dates and continuation/split rows. Entity-backed report rows are excluded from this second source to avoid duplication; the complete raw report is also retained. InventoryAdjustment has no documented query operation and US TaxPayment is not supported. Report-only coverage and unavailable dedicated APIs are disclosed, not treated as zero balances.

Hourly CDC uses a two-minute overlap and a cursor from the start of the successful scan. It falls back to full verification after a gap and at least daily. A saturated 1,000-object CDC response triggers a full entity scan and discloses that missing rows do not prove deletion. Pages are staged and published atomically. Duplicate IDs invalidate a scan. CDC tombstones retain the previous raw record plus the deletion observation. Full-scan absence is `missing_unverified`. History is append-only to the runtime. Failed runs retain the last published snapshot.

Owner account mapping and AccuLynx linkage decisions are separate, append-only administrator records; the sync cannot write them. Provisional CRM match suggestions require an exact amount, an Eastern reporting date, and an explicit job reference. They remain suggestions until an owner confirms them; unknown dates cannot match. Personal account references are excluded from business activity. The activity view intentionally shows source records without summing them: transfers, card repayments, bill settlements, linked deposits/payments and CRM records cannot become duplicate spending or revenue. Classification decisions and the estimated $600 allocation remain untouched.

## Deployment

Apply 005_quickbooks.sql and 006_quickbooks_permissions.sql. Apply the Insurance token-coordination migration before deploying its broker. Provision FINANCE_QBO_BROKER_KEY in Insurance and Finance and FINANCE_QBO_REALM_ID only in Insurance through runtime secret input. Never copy Intuit credentials or tokens. The enabled switch defaults false; verify pinned company and owner mappings before enabling. Read/refresh service credentials remain separate in Padawan. All financial snapshots stay outside repositories and Docker contexts.

## Limitations and official references (checked 2026-10-21)

- [Intuit OAuth](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0): retain the newest rotating refresh token; accounting scope is broader than read-only.
- [Production requirements](https://developer.intuit.com/app/developer/qbo/docs/go-live/publish-app): production app details and assessment apply even when a public App Store listing is unnecessary. Existing production credentials and company access were verified.
- [Data queries](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/data-queries): per-entity pagination, up to 1,000 rows.
- [CDC](https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api/change-data-capture): thirty-day lookback and 1,000-object limit.
- [Bank For Review limitation](https://help.developer.intuit.com/s/question/0D54R00007y2pv0SAA/pull-for-review-transactions-through-qbo-api): standard accounting API cannot retrieve the unposted bank-feed queue.

Per-account freshness describes the posted snapshot, not bank-feed freshness. CurrentBalance is a QuickBooks book balance, not a verified bank balance. Amex purchase coverage is absent: Bill Pay repayments do not supply itemized Amex expenses. No scraping, automatic posting, Plaid, paid provider or separate Amex connection is used.
