# Conversational Padawan read routing

The floating manager chat now calls an authenticated language interpreter before
selecting a read operation. It no longer relies on exact phrases when the interpreter
is configured. Typed input and keyboard-dictated speech use this same path. This
change does not add microphone capture, speech playback, real-time audio, autonomous
agent orchestration, or write actions.

## Runtime and rollout

Set BOTH `PADAWAN_OPENAI_API_KEY` and `PADAWAN_LANGUAGE_MODEL` on the JusticeOS Fly
app, not the separate Communications service. Use a model supporting Responses API
strict structured outputs; the existing pinned `gpt-4.1-mini-2025-04-14` is one
supported deployment choice. No model/key defaults are added. Credentials stay in
the gateway; never use VITE-prefixed variables for them. With neither/only one value
configured, the route returns LANGUAGE_NOT_CONFIGURED and the frontend retains
existing deterministic commands with an explicit limitation for unrecognized input.
A configured provider outage does not silently reinterpret a request with regexes.

One model call per submitted chat turn; no automatic retry. Context is limited to
eight recent turns, 1,500 characters per turn, and a 2,000-character question.
Context survives reload through the existing manager turn store when that backend
is available; this is not unlimited model memory. The interpreter sees recent chat
text, which may include snippets of private records, but never receives service keys.
Responses use store:false, a 20-second deadline, 1,600 output tokens, and a 128KB body
limit to accommodate echoed schema/instruction metadata. Generated text retains its
separate 16,000-character limit and strict plan validation. The single-owner gateway caps concurrent requests at two and submissions at
20/minute per process. Replicas each have their own cap, not a global spending limit.

## Voice interaction

Talk to Padawan records a question only after a user click and browser microphone
permission. Finish & ask uploads it, inserts the transcription as a normal user
turn, and calls the same conversational manager handler used by typed questions.
Recording stops at 60 seconds; Cancel, closing chat, hiding the page and unmounting
release the microphone. Permission grants arriving after cancellation are also
released. Transcription requests are aborted on cancellation; a read already
submitted to the manager can still complete and be saved.

The authenticated `/api/manager/transcribe` gateway requires an explicitly allowed
Origin, accepts WebM/MP4 recordings up to 2,000,000 bytes, limits each process to two
active requests and 20/minute, and uses the existing PADAWAN_OPENAI_API_KEY server
secret. Audio is sent to OpenAI's `/v1/audio/transcriptions` with `gpt-transcribe`.
The app does not write raw recordings to storage or log their content. This does
not override the provider's data retention policy. Provider errors are sanitized;
transcripts are limited to the same 2,000 characters as typed questions. No new
credentials or model-selected tools are exposed to the browser.

Spoken replies use native browser speech synthesis to read the displayed answer,
with Stop speaking, Spoken replies and Read reply controls. Voice quality and
automatic playback depend on the device/browser. Read reply is the explicit-click
fallback. This is turn-based recording, not an always-listening or realtime voice
session. Text chat remains usable when microphone or playback support is absent.
Real device validation is required after deployment.

API reference: https://developers.openai.com/api/docs/guides/speech-to-text

## Call answer presentation

Call recaps show up to three saved summary statements per call and up to three
calls in the main answer. Quotes, source call IDs, remaining results and extraction
warnings remain in a collapsed View evidence section. The response retains an
uncertainty notice when extraction warnings exist. Missing summaries are stated
plainly; transcript excerpts are not presented as summaries. Specific fact reads
retain quotation and reported-speaker qualification.

This presentation reuses stored evidence-reviewed summaries; it does not make an
additional model call or invent a new summary from raw transcript text. Asking for
more detail selects repeat and expands the original evidence when available,
without re-fetching a potentially different latest call. Recap and evidence are
stored together in the existing turn content using a readable separator and
restored separately in chat. Only recap text enters the language history.

The model selects at most three existing read operations: briefing, ledger views,
needs-reply emails, pending approvals, notifications, supported calendar views,
literal communications search, call lookup, saved call facts, explain, or repeat.
Follow-ups and corrections use recent conversation; ambiguous references should
produce one focused question. Unsupported ranges/filters/actions must be reported,
not silently broadened or narrowed. User approval cannot add a new capability.

All fields and operation kinds are validated server-side and again in the frontend.
No model-produced URL, HTTP method, code, write credential, approval or send operation
is accepted. Record reads still pass through existing authenticated allowlisted
Communications routes. Results retain their source quotations and current deterministic
rendering; there is no model rewrite of retrieved records. Partial multi-read failures
remain visible. Existing approval workflows remain separate and unchanged.

The user is single-owner under the existing gateway session model. Interpretation
requires that session, checks any supplied Origin against the gateway allowlist, and
returns Cache-Control:no-store. Provider errors are sanitized and chat/provider input
is never logged by this route. Stored chat and retrieved content are untrusted data,
not system instructions or verified entity identities.

## Verification and limitations

Tests cover schema/allowlist rejection, missing/oversized context, session and origin
checks, provider failures, response size, rate limits, context forwarding, multiple
reads, clarification, no write dispatch, and exact-command fallback when unconfigured.
Mocked responses validate the application contract, not real language understanding.
After configuring a candidate deployment, run the opt-in synthetic paid evaluation:

```
node --import tsx src/evaluateManagerLanguage.ts --run-paid-eval
```

Run from the gateway directory (or through its container). It requires the same two
environment variables and sends synthetic examples only. Each case is a model request;
no communications records are fetched, no actions are executed, and only case names
and pass/fail totals are printed. A failure blocks acceptance; inspect prompts/schema
and rerun targeted cases instead of treating valid JSON as proof of correct meaning.

Live checks should include paraphrases across calls, calendar, email and tasks,
pronoun ambiguity, a person correction, a clarified response, mixed read/write requests,
and unsupported time ranges. General semantic record search, arbitrary historical
calendar ranges, cross-agent tools, and reliable entity disambiguation are separate
capabilities; the language layer cannot manufacture them. Natural response synthesis
and full audio conversation remain follow-up work.

API format reference: https://developers.openai.com/api/docs/guides/structured-outputs
