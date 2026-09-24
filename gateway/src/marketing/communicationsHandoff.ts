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
import type { CommunicationsHandoff, HandoffState, MarketingEvent } from './events.js';

/** One bounded wait. A slow Communications Agent must not hold up an event sync. */
export const COMMUNICATIONS_TIMEOUT_MS = 5_000;

/**
 * The envelope JusticeOS hands over. Transport-neutral on purpose: it mirrors
 * the shape the Marketing Agent already writes into its own outbox
 * (`kind`/`idempotencyKey`/`schemaVersion`/`payload`), so whichever of the two
 * transports is wired later, the receiver sees the same thing.
 */
export interface CommunicationsEnvelope {
  readonly kind: 'MARKETING_EVENT';
  readonly schemaVersion: '1';
  /** The event identity. The receiver is expected to treat a repeat as a duplicate, not a second notification. */
  readonly idempotencyKey: string;
  readonly source: 'JUSTICEOS';
  readonly originAgent: 'MARKETING_AGENT';
  readonly payload: {
    readonly eventKind: string;
    readonly title: string;
    readonly summary: string;
    readonly severity: string | null;
    readonly significance: string | null;
    readonly trade: string | null;
    readonly channel: string | null;
    readonly detectedAt: string | null;
    readonly lastDetectedAt: string | null;
    readonly occurrences: number;
    /** The Marketing Agent's judgement that this is waiting on Austin. Not an instruction to contact him. */
    readonly ownerAttentionRequired: boolean;
  };
}

export function envelopeFor(event: MarketingEvent): CommunicationsEnvelope {
  return {
    kind: 'MARKETING_EVENT',
    schemaVersion: '1',
    idempotencyKey: event.id,
    source: 'JUSTICEOS',
    originAgent: 'MARKETING_AGENT',
    payload: {
      eventKind: event.kind,
      title: event.title,
      summary: event.summary,
      severity: event.severity,
      significance: event.significance,
      trade: event.trade,
      channel: event.channel,
      detectedAt: event.detectedAt,
      lastDetectedAt: event.lastDetectedAt,
      occurrences: event.occurrences,
      ownerAttentionRequired: event.ownerAttentionRequired
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
 * look delivered. JusticeOS still retains the event, so Austin can see it in
 * the app regardless.
 */
export const notConfiguredHandoff: CommunicationsHandoff = {
  configured: false,
  async deliver() {
    return {
      state: 'NOT_CONFIGURED' as HandoffState,
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
 * The real handoff, over HTTP.
 *
 * It sends one envelope, waits once, and classifies the answer. A 2xx is
 * delivered; a 409 is the receiver telling us it already had this one, which
 * is a success for our purposes and is recorded as DUPLICATE so the
 * distinction survives in the ledger. Anything else is FAILED and stays
 * FAILED — there is no retry here, because a second identical POST to a
 * receiver that is down is a retry storm waiting for a bad afternoon, and the
 * next scheduled sync will try again on its own schedule anyway.
 */
export function createHttpCommunicationsHandoff(options: HttpCommunicationsHandoffOptions): CommunicationsHandoff {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? COMMUNICATIONS_TIMEOUT_MS;

  return {
    configured: true,
    async deliver(event: MarketingEvent) {
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
        return { state: 'FAILED' as HandoffState, ref: null, detail: timedOut ? 'The Communications Agent did not answer in time.' : 'The Communications Agent could not be reached.' };
      }

      logInfo('communications handoff', { url: redactedUrl(options.endpoint), status: response.status, eventKind: event.kind });

      if (response.status === 409) {
        return { state: 'DUPLICATE' as HandoffState, ref: envelope.idempotencyKey, detail: 'The Communications Agent already held this event.' };
      }
      if (response.status < 200 || response.status >= 300) {
        return { state: 'FAILED' as HandoffState, ref: null, detail: `The Communications Agent answered ${response.status}.` };
      }
      return { state: 'DELIVERED' as HandoffState, ref: envelope.idempotencyKey, detail: null };
    }
  };
}
