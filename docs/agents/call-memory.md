# Call memory read integration

Requires communications-agent PR #39 deployed with its memory feature configured.
Automatic extraction is controlled by that service; Padawan never sends extraction
requests or holds an OpenAI key for this integration.

The authenticated gateway allows GET reads for call-memory, call-memory/facts,
and call-memory/jobs. Existing server-side Communications read credentials apply.
No browser credential is forwarded upstream and no mutation route is exposed.

Manager chat recognizes:
- Summarize my calls from today.
- Tell me the last thing I spoke about with Chase.
- When did me and Chase talk about shingles?
- What color shingles did Peter say he wants on his roof?

Today is resolved by the Communications service business timezone. Answers show
saved summaries or clearly labeled transcript excerpts, dates, source IDs, and
evidence quotes. Reported statements remain distinct from direct confirmation.
The search uses literal names and topics; it is not general semantic search or
verified voice identification. More matching results are explicitly indicated.
