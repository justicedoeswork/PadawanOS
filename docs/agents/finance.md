# Finance Agent integration

The authenticated Manager routes structured financial questions to the private `justicedoeswork/finance-agent` service. It owns durable source synchronization and financial query semantics. The gateway holds distinct FINANCE_READ_KEY and FINANCE_REFRESH_KEY runtime secrets; the browser receives neither. FINANCE_AGENT_BASE_URL must be `http://justice-finance-agent.internal:8790`.

Ask about received payments this month, costs for a job, changes since the last refresh, or undated/unpaid/unreconciled records. Answers show period, freshness and limitations. Finance status & refresh displays counts, current progress and failures; Refresh now requires a session, trusted Origin, separate server credential and the Finance Agent's overlap/cooldown checks. Language-model output cannot invoke refresh or arbitrary SQL/URLs.

The Finance Agent scans every job hourly at :05, including old jobs, with a nightly scan at 02:05 America/New_York. Durable PostgreSQL leases prevent overlap. The existing AccuLynx routes and export remain unchanged and manual. Padawan has no financial scheduler. Marketing lead synchronization is outside this financial feed.

Rollback before/after switch: unset FINANCE_AGENT_BASE_URL or redeploy the previous justiceos image; disable the Finance database schedule if retiring its worker. Keep the isolated Finance schema and history. The original authenticated AccuLynx export remains available. Never add source exports or secrets to either repository/build context.

Reporting dates remain provisional pending comparison with an actual source report. Reviewed classifications and the estimated $600 allocation must come from the actual reviewed artifact, never model memory. CRM entries do not establish bank cash, complete AP or finalized profit. No bank connection is configured.
