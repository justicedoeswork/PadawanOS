/**
 * The last hop: JusticeOS → Communications Agent.
 *
 * The rule this file exists to hold is narrow and absolute. **Marketing
 * decides what matters; Communications decides how Austin hears about it.**
 * So what crosses this boundary is an event — what happened, how significant
 * the Marketing Agent judged it, and whether it is waiting on the owner. What
 * does not cross it: a channel, a phone number, an email address, a template,
 * a send time, or any instruction to notify anyone. Those are the
 * Communications Agent's decisions, and a JusticeOS that made them here would
 * have quietly become a notification service.
 *
 * And, explicitly: `MARKETING_AGENT_API_KEY` never appears in this path. The
 * Communications Agent authenticates with its own credential
 * (`COMMUNICATIONS_AGENT_API_KEY`), which is a different secret for a
 * different service — enforced below by constructing the header from that one
 * field, and by a test that asserts the marketing credential reaches no
 * Communications request.
 */
import { logError, logInfo, redactedUrl } from '../log.js';
import type { CommunicationsHandoff, DeliveryAttemptContext, HandoffOutcome, HandoffReceipt } from './events.js';
import { JUSTICEOS_CONSUMER_ID, type OutboundMarketingEvent } from './outboxEvents.js';

/**
 * One bounded wait per event. This is the number the relay's claim TTL is
 * sized against (see `eventRelay.ts`): a claim must outlive the worst case
 * of delivering every event in the batch, or JusticeOS would be acknowledging
 * events it no longer holds.
 */
export const COMMUNICATIONS_TIMEOUT_MS = 5_000;

/**
 * The envelope JusticeOS hands over.
 *
 * It carries the Marketing Agent's own projection of the event, relayed
 * field-for-field, plus the three identifiers the receiver needs to dedupe:
 * the outbox id, the agent's idempotency key (unique per event occurrence),
 * and its dedupe key (stable across recurrences of the same problem). Those
 * are the agent's handles, not JusticeOS's — this gateway invents no identity
 * of its own for an event that already has three.
 */
export interface CommunicationsEnvelope {
  readonly kind: 'MARKETING_EVENT';
  readonly schemaVersion: '1';
  /** The agent's idempotency key. The receiver is expected to treat a repeat as a duplicate, not a second notification. */
  readonly idempotencyKey: string;
  readonly source: 'JUSTICEOS';
  readonly originAgent: 'MARKETING_AGENT';
  /** Which relay sent it. Stable across deploys — see `JUSTICEOS_CONSUMER_ID`. */
  readonly consumer: string;
  readonly payload: {
    /** The outbox row this came from, so the receiver can be asked about it later. */
    readonly outboxId: string;
    readonly eventId: string | null;
    /** The public MARKETING_* name where the agent has one. */
    readonly eventKind: string;
    /** The agent's durable internal type, for events with no public name. */
    readonly internalType: string;
    readonly title: string | null;
    readonly summary: string | null;
    readonly detailedReasoning: string | null;
    readonly severity: string | null;
    readonly significance: string | null;
    readonly trade: string | null;
    readonly channel: string | null;
    readonly evidence: unknown;
    readonly recommendedAction: string | null;
    readonly recommendedDeadline: string | null;
    /** The Marketing Agent's judgement that this is waiting on Austin. Not an instruction to contact him. */
    readonly ownerApprovalRequired: boolean;
    readonly firstDetectedAt: string | null;
    readonly lastDetectedAt: string | null;
    readonly occurrenceCount: number | null;
    readonly confidence: number | null;
    readonly dedupeKey: string | null;
    readonly emittedAt: string | null;
    readonly enqueuedAt: string | null;
  };
}

export function envelopeFor(event: OutboundMarketingEvent): CommunicationsEnvelope {
  return {
    kind: 'MARKETING_EVENT',
    schemaVersion: '1',
    idempotencyKey: event.idempotencyKey,
    source: 'JUSTICEOS',
    originAgent: 'MARKETING_AGENT',
    consumer: JUSTICEOS_CONSUMER_ID,
    payload: {
      outboxId: event.id,
      eventId: event.eventId,
      eventKind: event.kind,
      internalType: event.internalType,
      title: event.title,
      summary: event.summary,
      detailedReasoning: event.detailedReasoning,
      severity: event.severity,
      significance: event.significance,
      trade: event.trade,
      channel: event.channel,
      evidence: event.evidence,
      recommendedAction: event.recommendedAction,
      recommendedDeadline: event.recommendedDeadline,
      ownerApprovalRequired: event.ownerApprovalRequired,
      firstDetectedAt: event.firstDetectedAt,
      lastDetectedAt: event.lastDetectedAt,
      occurrenceCount: event.occurrenceCount,
      confidence: event.confidence,
      dedupeKey: event.dedupeKey,
      emittedAt: event.freshness.emittedAt,
      enqueuedAt: event.freshness.enqueuedAt
    }
  };
}

/**
 * The default in every deployment that has not configured a Communications
 * Agent endpoint — which, today, is all of them.
 *
 * It reports NOT_CONFIGURED and nothing else. It does not fall back to
 * emailing anyone, does not queue for a retry that will never come, and above
 * all does not report success: an event that nobody was told about must not
 * look delivered. The relay treats NOT_CONFIGURED as a reason to take NO
 * claim at all (see `eventRelay.ts`), so an unwired deployment neither
 * strands events upstream nor burns their retry budget — it reads them,
 * retains them for the app, and says plainly that nobody was notified.
 */
export const notConfiguredHandoff: CommunicationsHandoff = {
  configured: false,
  async deliver() {
    return {
      outcome: 'NOT_CONFIGURED' as HandoffOutcome,
      ref: null,
      detail: 'No Communications Agent endpoint is configured on this gateway; the event is retained in JusticeOS and nobody was contacted.'
    };
  }
};

export interface HttpCommunicationsHandoffOptions {
  /** The Communications Agent's inbound event endpoint, a private/internal destination. */
  readonly endpoint: string;
  /** The COMMUNICATIONS Agent's own credential. Never the Marketing Agent's. */
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Classifies one HTTP answer.
 *
 * The line between RETRYABLE and FINAL is drawn by what a second identical
 * request would do, not by how bad the status sounds:
 *
 *   - The receiver refused **this message** (400, 404, 415, 422) — the same
 *     envelope will be refused identically forever, so it is FINAL and the
 *     event is kept upstream as a failure rather than cycling for hours.
 *   - The receiver refused **us**, or could not answer (401, 403, 408, 429,
 *     5xx, timeout, connection failure) — a credential nobody has fixed yet
 *     and a service that is down are both conditions a human resolves while
 *     the backoff runs, so the event stays deliverable.
 *   - 409 is the receiver telling us it already had this one. That is not a
 *     failure and not a delivery: it is DUPLICATE, and the distinction is
 *     carried all the way back to Marketing.
 */
export function classifyStatus(status: number): HandoffOutcome {
  if (status === 409) return 'DUPLICATE';
  if (status >= 200 && status < 300) return 'ACCEPTED';
  if (status === 400 || status === 404 || status === 405 || status === 415 || status === 422) return 'FINAL';
  return 'RETRYABLE';
}

/**
 * The real handoff, over HTTP.
 *
 * It sends one envelope and waits once. There is no retry here: retrying is
 * the outbox's job, and it does it properly — a retryable acknowledgement
 * puts the event back in the queue behind a backoff that doubles, with a
 * ceiling. A second immediate POST to a receiver that is down is a retry storm
 * waiting for a bad afternoon.
 */
export function createHttpCommunicationsHandoff(options: HttpCommunicationsHandoffOptions): CommunicationsHandoff {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? COMMUNICATIONS_TIMEOUT_MS;

  return {
    configured: true,
    async deliver(event: OutboundMarketingEvent, context: DeliveryAttemptContext): Promise<HandoffReceipt> {
      const envelope = envelopeFor(event);
      let response: Response;
      try {
        response = await doFetch(options.endpoint, {
          method: 'POST',
          headers: {
            // The Communications Agent's credential, and only it.
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'idempotency-key': envelope.idempotencyKey
          },
          body: JSON.stringify(envelope),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        logError('communications handoff failed', { url: redactedUrl(options.endpoint), reason: timedOut ? 'timeout' : 'network' });
        return {
          outcome: 'RETRYABLE',
          ref: null,
          detail: timedOut ? 'The Communications Agent did not answer in time.' : 'The Communications Agent could not be reached.'
        };
      }

      logInfo('communications handoff', { url: redactedUrl(options.endpoint), status: response.status, eventKind: event.kind, outboxId: context.outboxId });

      const outcome = classifyStatus(response.status);
      if (outcome === 'DUPLICATE') {
        return { outcome, ref: envelope.idempotencyKey, detail: 'The Communications Agent already held this event.' };
      }
      if (outcome === 'ACCEPTED') {
        return { outcome, ref: envelope.idempotencyKey, detail: null };
      }
      return { outcome, ref: null, detail: `The Communications Agent answered ${response.status}.` };
    }
  };
}
