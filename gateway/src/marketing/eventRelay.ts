/**
 * The relay: Marketing outbox → JusticeOS → Communications → back to Marketing.
 *
 * One cycle is claim → deliver → acknowledge, and the order is the whole
 * safety argument:
 *
 *   - **Claiming before delivering** is what stops two relay passes both
 *     sending the same event. The claim is a conditional UPDATE upstream: the
 *     loser's statement matches nothing, so it simply gets no events. A read
 *     (`GET /agent/events`) takes nothing and settles nothing, which is why
 *     this relay never treats one as a delivery.
 *   - **Acknowledging after delivering** is what stops an event being lost.
 *     Every outcome is reported — including "already handled" and "this will
 *     never work" — so the outbox always knows where a message stands, and the
 *     immutable delivery log upstream always says how it got there.
 *   - **Not acknowledging what it did not do** is what stops a fabricated
 *     success. A claim that has lapsed, an event the agent has never heard of,
 *     and an event already settled upstream are all reported as themselves and
 *     none of them is turned into a DELIVERED.
 *
 * What this relay does NOT do: decide anything about a notification. It never
 * chooses email or text, never names a recipient, never writes marketing copy
 * and never picks a send time. Marketing decided WHAT matters; Communications
 * decides whether Austin is interrupted and how. JusticeOS carries the
 * envelope and reports the result.
 *
 * And it is not a second scheduler. It drives no Marketing research and fires
 * no ticks — it moves events that already exist, and something outside this
 * process decides when (see §12 of the integration doc).
 */
import crypto from 'node:crypto';
import { COMMUNICATIONS_TIMEOUT_MS } from './communicationsHandoff.js';
import type { CommunicationsHandoff, DeliveryAttemptContext, MarketingEvent, MarketingEventStatus, MarketingEventStore } from './events.js';
import type { MarketingOperations, OperationOutcome } from './operations.js';
import {
  JUSTICEOS_CONSUMER_ID,
  parseAckOutcome,
  parseClaim,
  parseEventListing,
  type DeliveryResult,
  type OutboundMarketingEvent
} from './outboxEvents.js';
import type { RequestContext } from './requestIdentity.js';

export { JUSTICEOS_CONSUMER_ID };

/**
 * How many events one cycle takes. Small on purpose: the claim TTL below is
 * sized against this number, and a relay that grabs a hundred events holds a
 * hundred events hostage if it dies halfway through.
 */
export const RELAY_CLAIM_LIMIT = 10;

/** One bounded wait per acknowledgement. Short, because an uncertain one is retried. */
export const ACK_TIMEOUT_MS = 10_000;

/**
 * The worst case for one event: the Communications wait, plus the
 * acknowledgement and its one retry.
 */
export const PER_EVENT_BUDGET_MS = COMMUNICATIONS_TIMEOUT_MS + ACK_TIMEOUT_MS * 2;

/**
 * How long the claim is held.
 *
 * Sized from the worst case rather than picked: ten events at
 * 5s + 2×10s each is 250 seconds, so ten minutes is roughly 2.4× the longest
 * this cycle can legitimately take. It is deliberately not larger. A claim is
 * a promise that this relay will either deliver the event or die trying, and
 * an over-long one means a crashed relay strands events for as long as it
 * lasts. The agent clamps it to 30s–30m, so this is a real value inside the
 * allowed band rather than a request for the maximum.
 */
export const RELAY_CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * The relay stops handing out work when less than this much of the claim
 * remains, and lets the rest lapse rather than delivering an event whose claim
 * would expire before it could be acknowledged. An acknowledgement refused for
 * a lapsed claim is a delivery nobody recorded — the one outcome worth
 * spending a whole extra cycle to avoid.
 */
export const CLAIM_SAFETY_MARGIN_MS = PER_EVENT_BUDGET_MS;

/**
 * The ack key for one delivery attempt.
 *
 * Derived, not random, and derived from the CLAIM TOKEN specifically. That
 * single choice gives both properties the contract needs:
 *
 *   - Within one claim it is stable, so an acknowledgement whose response was
 *     lost can be re-sent verbatim and Marketing's unique `(outboxId, ackKey)`
 *     replays the recorded result instead of counting a second attempt. The
 *     relay reuses it across cycles too, not just within one.
 *   - Across claims it differs, because a new claim has a new token. So a
 *     genuine second attempt after a retryable failure is counted as one,
 *     rather than being silently replayed as the first attempt's result.
 *
 * Being derived rather than stored also means a process that restarts mid-
 * delivery recomputes the same key from the same claim, instead of inventing a
 * new one and double-counting the attempt.
 */
export function ackKeyFor(consumer: string, outboxId: string, claimToken: string): string {
  // Length-prefixed rather than delimiter-joined, so no two different triples
  // can hash the same by running their parts together — whatever an id turns
  // out to contain, and without depending on a separator nobody ever uses.
  const parts = [consumer, outboxId, claimToken].map((part) => `${part.length}:${part}`).join('');
  const digest = crypto.createHash('sha256').update(parts).digest('hex').slice(0, 32);
  return `justiceos-ack-${digest}`;
}

/** What one cycle did. Every number is a count of things that actually happened, never an intention. */
export interface RelayCycleReport {
  readonly ranAt: string;
  readonly consumer: string;
  readonly handoffConfigured: boolean;
  /** CLAIM_AND_DELIVER when a Communications endpoint is wired; READ_ONLY when none is. */
  readonly mode: 'CLAIM_AND_DELIVER' | 'READ_ONLY';
  readonly claimToken: string | null;
  readonly claimExpiresAt: string | null;
  readonly claimed: number;
  readonly delivered: number;
  readonly duplicate: number;
  readonly retryScheduled: number;
  readonly failed: number;
  /** Claimed but deliberately not delivered, because the claim was running out. Left to lapse and be re-offered. */
  readonly abandoned: number;
  /** Delivered, but the acknowledgement could not be confirmed. Retried with the SAME ack key next cycle. */
  readonly ackUncertain: number;
  /** Acknowledgements the agent refused deterministically. Not retried with the same key; a standing integration problem. */
  readonly ackRefused: number;
  /** Acknowledgements Marketing replayed rather than counting again. */
  readonly ackReplayed: number;
  readonly claimInvalid: number;
  readonly alreadyFinal: number;
  readonly notFound: number;
  /** Events read but not taken (READ_ONLY mode only). */
  readonly observed: number;
  /** Why the Marketing integration is degraded, if it is. Never empty on a contract failure. */
  readonly degraded: readonly string[];
  readonly events: readonly MarketingEvent[];
}

/**
 * A cycle either ran (and says what it did), or could not start at all — an
 * unconfigured integration, an unreachable agent, or a contract this build
 * cannot read. The second kind is the caller's own outcome to render, exactly
 * as for any other operation, so the relay does not invent a second error
 * vocabulary for the same conditions.
 */
export type RelayResult = { readonly kind: 'cycle'; readonly report: RelayCycleReport } | { readonly kind: 'outcome'; readonly outcome: OperationOutcome };

export interface EventRelayOptions {
  readonly operations: MarketingOperations;
  readonly store: MarketingEventStore;
  readonly handoff: CommunicationsHandoff;
  readonly consumer?: string;
  readonly limit?: number;
  readonly ttlMs?: number;
  readonly now?: () => Date;
}

function outcomeToResult(outcome: 'ACCEPTED' | 'DUPLICATE' | 'RETRYABLE' | 'FINAL' | 'NOT_CONFIGURED'): DeliveryResult {
  switch (outcome) {
    case 'ACCEPTED':
      return 'DELIVERED';
    case 'DUPLICATE':
      return 'DUPLICATE';
    case 'FINAL':
      return 'FAILED_FINAL';
    // A handoff that reports itself unconfigured while holding a claim should
    // be impossible — the relay does not claim in that case — so it is treated
    // as a transient failure rather than burning the event's final attempt.
    case 'NOT_CONFIGURED':
    case 'RETRYABLE':
      return 'FAILED_RETRYABLE';
  }
}

function localStatusFor(result: DeliveryResult): MarketingEventStatus {
  switch (result) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'DUPLICATE':
      return 'DUPLICATE';
    case 'FAILED_RETRYABLE':
      return 'RETRY_PENDING';
    case 'FAILED_FINAL':
      return 'FAILED';
  }
}

/** The Marketing Agent's own error code out of a refusal body, without assuming the body is shaped as one. */
function errorCodeOf(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const error = (body as Record<string, unknown>).error;
  if (error === null || typeof error !== 'object') return null;
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

function errorDetailsOf(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== 'object') return {};
  const error = (body as Record<string, unknown>).error;
  if (error === null || typeof error !== 'object') return {};
  const details = (error as Record<string, unknown>).details;
  return details !== null && typeof details === 'object' ? (details as Record<string, unknown>) : {};
}

/** Marketing's terminal outbox status, translated to the JusticeOS status that means the same thing. */
function reconcileUpstreamStatus(upstream: unknown): MarketingEventStatus {
  switch (upstream) {
    case 'DELIVERED':
      return 'DELIVERED';
    case 'DUPLICATE':
      return 'DUPLICATE';
    case 'FAILED':
      return 'FAILED';
    default:
      // The agent says this event is settled but not which way. Recording it
      // as delivered would be a guess in the one direction that cannot be
      // taken back, so it is recorded as failed-to-relay instead.
      return 'FAILED';
  }
}

/** How one acknowledgement ended, from the relay's point of view. */
type AckDisposition =
  | { readonly kind: 'recorded'; readonly replayed: boolean; readonly status: MarketingEventStatus }
  | { readonly kind: 'claim-invalid'; readonly detail: string }
  | { readonly kind: 'already-final'; readonly status: MarketingEventStatus; readonly detail: string }
  | { readonly kind: 'not-found'; readonly detail: string }
  /** Deterministically refused. Not retried with this key, now or ever — it would be refused identically. */
  | { readonly kind: 'refused'; readonly detail: string }
  | { readonly kind: 'uncertain'; readonly detail: string }
  | { readonly kind: 'contract-failure'; readonly outcome: OperationOutcome; readonly detail: string };

export interface EventRelay {
  readonly consumer: string;
  /** One claim → deliver → acknowledge pass. Safe to call again immediately; it simply finds nothing due. */
  runCycle(context: RequestContext): Promise<RelayResult>;
}

export function createEventRelay(options: EventRelayOptions): EventRelay {
  const consumer = options.consumer ?? JUSTICEOS_CONSUMER_ID;
  const limit = options.limit ?? RELAY_CLAIM_LIMIT;
  const ttlMs = options.ttlMs ?? RELAY_CLAIM_TTL_MS;
  const now = options.now ?? (() => new Date());
  const { operations, store, handoff } = options;

  /**
   * Sends one acknowledgement, retrying ONCE with the same ack key if the
   * answer is uncertain.
   *
   * "Uncertain" means the relay does not know whether the first call landed:
   * a timeout, a dropped connection, or a 5xx. That is precisely the case the
   * ack key exists for — re-sending it either replays the result the agent
   * already recorded or records it for the first time, and cannot produce two
   * attempts. A NEW key here would defeat the whole mechanism, so the same one
   * is passed on every try, including on the next cycle if both tries fail.
   */
  async function acknowledge(
    context: RequestContext,
    attempt: DeliveryAttemptContext,
    result: DeliveryResult,
    detail: string | null
  ): Promise<AckDisposition> {
    let lastDetail = 'The Marketing Agent did not confirm the acknowledgement.';

    for (let tries = 0; tries < 2; tries += 1) {
      const outcome = await operations.acknowledgeEvent(context, {
        outboxId: attempt.outboxId,
        result,
        consumer,
        claimToken: attempt.claimToken,
        ackKey: attempt.ackKey,
        ...(detail ? { detail } : {}),
        timeoutMs: ACK_TIMEOUT_MS
      });

      if (outcome.kind === 'answer') {
        const parsed = parseAckOutcome(outcome.answer.result);
        if (parsed.kind === 'invalid') {
          return {
            kind: 'contract-failure',
            outcome: { kind: 'invalid-contract', problems: parsed.problems, operation: 'acknowledgeEvent' },
            detail: `The acknowledgement answer could not be read: ${parsed.problems.join('; ')}.`
          };
        }
        return { kind: 'recorded', replayed: parsed.value.replayed, status: localStatusFor(result) };
      }

      if (outcome.kind === 'agent-error') {
        const code = errorCodeOf(outcome.body);
        const details = errorDetailsOf(outcome.body);

        // 409: the claim expired or was never ours. Do NOT re-authenticate and
        // do NOT try a different acknowledgement — the event goes back into the
        // normal claim cycle and is picked up on a later pass.
        if (code === 'EVENT_CLAIM_INVALID') {
          return {
            kind: 'claim-invalid',
            detail: `The claim on this event is no longer valid (${String(details.refusal ?? 'expired')}); it will be claimed again on a later cycle rather than acknowledged now.`
          };
        }
        // 409: already settled upstream. Stop working on it and reconcile.
        if (code === 'EVENT_ALREADY_FINAL') {
          return {
            kind: 'already-final',
            status: reconcileUpstreamStatus(details.status),
            detail: `The Marketing Agent has already settled this event as ${String(details.status ?? 'final')}; JusticeOS stopped delivering it and matched its own record.`
          };
        }
        // 404: the agent has no such event. An integration inconsistency, and
        // explicitly not a success — whatever happened downstream, this
        // acknowledgement did not.
        if (code === 'EVENT_NOT_FOUND') {
          return { kind: 'not-found', detail: `The Marketing Agent has no outbox event ${attempt.outboxId}, so nothing could be acknowledged for it.` };
        }
        // Any other refusal the agent answers deterministically — a malformed
        // acknowledgement, a rejected credential — will answer the same way to
        // an identical retry, so it is neither retried now nor carried into
        // the next cycle: an ack key that can never be accepted would be
        // re-sent forever. It is recorded as a standing integration problem
        // instead, and the claim is left to lapse so the outbox offers the
        // event again under a fresh one.
        if (outcome.status < 500) {
          return { kind: 'refused', detail: `The Marketing Agent refused the acknowledgement (${code ?? `HTTP ${outcome.status}`}) and would refuse an identical retry.` };
        }
        lastDetail = `The Marketing Agent answered ${outcome.status} to the acknowledgement.`;
        continue;
      }

      if (outcome.kind === 'unavailable') {
        lastDetail = `The Marketing Agent did not answer the acknowledgement (${outcome.reason}).`;
        continue;
      }

      // not-configured / actor-not-configured / a contract failure: the
      // integration itself is the problem, and it is reported as such.
      return { kind: 'contract-failure', outcome, detail: 'The Marketing Agent integration could not accept the acknowledgement.' };
    }

    return { kind: 'uncertain', detail: lastDetail };
  }

  /**
   * Re-sends acknowledgements whose answer was lost, before doing anything
   * else.
   *
   * This is the other half of the same-ack-key rule. An uncertain
   * acknowledgement is not abandoned at the end of a cycle — it is retried on
   * the next one with the key and token it already used, so Marketing replays
   * the recorded result if the original landed, or records it for the first
   * time if it did not. Either way the attempt count does not double.
   */
  async function resolveUncertainAcks(context: RequestContext, report: Mutable): Promise<void> {
    for (const retained of store.list()) {
      const attempt = retained.attempt;
      const intended = retained.delivery.acknowledgedResult;
      if (!attempt || retained.delivery.acknowledged || intended === null) continue;

      const disposition = await acknowledge(context, attempt, intended as DeliveryResult, retained.delivery.detail);
      applyAckDisposition(retained.event, intended as DeliveryResult, retained.delivery.detail, retained.delivery.ref, disposition, report);
      const settled = store.get(retained.id);
      if (settled) report.touched.push(settled);
    }
  }

  /** One place that turns an acknowledgement's fate into a local record and a count. */
  function applyAckDisposition(
    event: OutboundMarketingEvent,
    result: DeliveryResult,
    detail: string | null,
    ref: string | null,
    disposition: AckDisposition,
    report: Mutable
  ): void {
    switch (disposition.kind) {
      case 'recorded':
        store.settle(event.id, disposition.status, { detail, acknowledgedResult: result, acknowledged: true, ref });
        if (disposition.replayed) report.ackReplayed += 1;
        countTerminal(disposition.status, report);
        return;
      case 'claim-invalid':
        // Not a failure of the event, and deliberately not acknowledged as
        // one: it simply is not ours right now.
        store.settle(event.id, 'RETRY_PENDING', { detail: disposition.detail, acknowledgedResult: null, acknowledged: false });
        report.claimInvalid += 1;
        return;
      case 'already-final':
        store.settle(event.id, disposition.status, { detail: disposition.detail, acknowledgedResult: null, acknowledged: true });
        report.alreadyFinal += 1;
        countTerminal(disposition.status, report);
        return;
      case 'not-found':
        // The delivery may well have happened; the acknowledgement certainly
        // did not. Both facts are recorded, and neither is upgraded.
        store.settle(event.id, localStatusFor(result), { detail: disposition.detail, acknowledgedResult: result, acknowledged: false });
        report.notFound += 1;
        report.degraded.push(disposition.detail);
        return;
      case 'refused':
        // No intended result is kept, so this is NOT re-sent next cycle: the
        // same key would be refused identically. The claim lapses, the outbox
        // offers the event again under a fresh one, and the refusal stands as
        // a named integration problem in the meantime.
        store.settle(event.id, 'RETRY_PENDING', { detail: disposition.detail, acknowledgedResult: null, acknowledged: false });
        report.ackRefused += 1;
        report.degraded.push(disposition.detail);
        return;
      case 'uncertain':
        // The intended result is kept so the next cycle can re-send it with
        // the same ack key. This is the only state that survives a cycle.
        store.settle(event.id, localStatusFor(result), { detail: disposition.detail, acknowledgedResult: result, acknowledged: false });
        report.ackUncertain += 1;
        return;
      case 'contract-failure':
        store.settle(event.id, localStatusFor(result), { detail: disposition.detail, acknowledgedResult: result, acknowledged: false });
        report.ackUncertain += 1;
        report.degraded.push(disposition.detail);
        return;
    }
  }

  function countTerminal(status: MarketingEventStatus, report: Mutable): void {
    if (status === 'DELIVERED') report.delivered += 1;
    else if (status === 'DUPLICATE') report.duplicate += 1;
    else if (status === 'FAILED') report.failed += 1;
    else if (status === 'RETRY_PENDING') report.retryScheduled += 1;
  }

  async function runCycle(context: RequestContext): Promise<RelayResult> {
    const ranAt = now().toISOString();
    const report: Mutable = {
      ranAt,
      consumer,
      handoffConfigured: handoff.configured,
      mode: handoff.configured ? 'CLAIM_AND_DELIVER' : 'READ_ONLY',
      claimToken: null,
      claimExpiresAt: null,
      claimed: 0,
      delivered: 0,
      duplicate: 0,
      retryScheduled: 0,
      failed: 0,
      abandoned: 0,
      ackUncertain: 0,
      ackRefused: 0,
      ackReplayed: 0,
      claimInvalid: 0,
      alreadyFinal: 0,
      notFound: 0,
      observed: 0,
      degraded: [],
      touched: []
    };

    // Outstanding acknowledgements first, in both modes: an unconfirmed
    // "delivered" is the one piece of state that must not wait for a
    // Communications endpoint to be wired.
    await resolveUncertainAcks(context, report);

    if (!handoff.configured) {
      // No Communications endpoint means there is nothing this relay could
      // honestly promise about an event, so it claims nothing at all. It reads
      // instead — which takes nothing and settles nothing upstream — so Austin
      // can still see in the app what the agent has raised, and the events
      // stay PENDING for whoever eventually does wire a receiver.
      const outcome = await operations.listEvents(context, { status: 'PENDING', limit });
      if (outcome.kind !== 'answer') return { kind: 'outcome', outcome };
      const parsed = parseEventListing(outcome.answer.result);
      if (parsed.kind === 'invalid') {
        return { kind: 'outcome', outcome: { kind: 'invalid-contract', problems: parsed.problems, operation: 'events' } };
      }
      const observed = store.observe(parsed.value.events);
      report.observed = observed.length;
      report.touched.push(...observed);
      report.degraded.push('No Communications Agent endpoint is configured, so marketing events are read and retained but no event is claimed and nobody is notified.');
      return { kind: 'cycle', report: finish(report) };
    }

    const claimOutcome = await operations.claimEvents(context, { consumer, limit, ttlMs });
    if (claimOutcome.kind !== 'answer') return { kind: 'outcome', outcome: claimOutcome };

    const claim = parseClaim(claimOutcome.answer.result);
    if (claim.kind === 'invalid') {
      return { kind: 'outcome', outcome: { kind: 'invalid-contract', problems: claim.problems, operation: 'claimEvents' } };
    }

    report.claimToken = claim.value.claimToken;
    report.claimExpiresAt = claim.value.expiresAt;
    report.claimed = claim.value.events.length;

    const deadline = claim.value.expiresAt ? Date.parse(claim.value.expiresAt) : Number.NaN;

    for (const event of claim.value.events) {
      const attempt: DeliveryAttemptContext = {
        outboxId: event.id,
        eventId: event.eventId,
        kind: event.kind,
        claimToken: claim.value.claimToken,
        ackKey: ackKeyFor(consumer, event.id, claim.value.claimToken),
        idempotencyKey: event.idempotencyKey,
        dedupeKey: event.dedupeKey,
        claimExpiresAt: claim.value.expiresAt,
        startedAt: now().toISOString()
      };

      // Do not hold the claim indefinitely, and do not start work the claim
      // cannot cover. What is left simply lapses and is offered again — which
      // is the outcome the lease was designed for.
      if (Number.isFinite(deadline) && now().getTime() + CLAIM_SAFETY_MARGIN_MS > deadline) {
        store.observe([event]);
        store.settle(event.id, 'RETRY_PENDING', {
          detail: 'The claim was running out before this event could be delivered, so JusticeOS stopped and let it lapse rather than risk an unacknowledgeable delivery.',
          acknowledgedResult: null,
          acknowledged: false
        });
        report.abandoned += 1;
        const abandoned = store.get(event.id);
        if (abandoned) report.touched.push(abandoned);
        continue;
      }

      // JusticeOS's own idempotency, in front of the send. An event this
      // gateway has already handled is NOT sent again — and is reported as
      // DUPLICATE, never as DELIVERED, because "I already handled this" is
      // different evidence from "I delivered this" and the distinction is the
      // only signal that our dedupe caught something the outbox did not.
      const handled = store.alreadyHandled(event);
      if (handled) {
        store.beginDelivery(event, attempt);
        const disposition = await acknowledge(
          context,
          attempt,
          'DUPLICATE',
          `JusticeOS had already handled this event as ${handled.status} on ${handled.delivery.at}; it was not sent to Communications again.`
        );
        applyAckDisposition(event, 'DUPLICATE', 'Already handled by JusticeOS; not sent again.', handled.delivery.ref, disposition, report);
        const settled = store.get(event.id);
        if (settled) report.touched.push(settled);
        continue;
      }

      store.beginDelivery(event, attempt);
      const receipt = await handoff.deliver(event, attempt);
      const result = outcomeToResult(receipt.outcome);
      const disposition = await acknowledge(context, attempt, result, receipt.detail);
      applyAckDisposition(event, result, receipt.detail, receipt.ref, disposition, report);
      const settled = store.get(event.id);
      if (settled) report.touched.push(settled);
    }

    return { kind: 'cycle', report: finish(report) };
  }

  return { consumer, runCycle };
}

/** The report while it is being built. Counts move; the shape does not. */
interface Mutable {
  ranAt: string;
  consumer: string;
  handoffConfigured: boolean;
  mode: 'CLAIM_AND_DELIVER' | 'READ_ONLY';
  claimToken: string | null;
  claimExpiresAt: string | null;
  claimed: number;
  delivered: number;
  duplicate: number;
  retryScheduled: number;
  failed: number;
  abandoned: number;
  ackUncertain: number;
  ackRefused: number;
  ackReplayed: number;
  claimInvalid: number;
  alreadyFinal: number;
  notFound: number;
  observed: number;
  degraded: string[];
  touched: MarketingEvent[];
}

function finish(report: Mutable): RelayCycleReport {
  const { touched, degraded, ...rest } = report;
  // De-duplicated by id, keeping the last record of each: one event can be
  // touched twice in a cycle (an uncertain ack resolved, then re-claimed).
  const byId = new Map<string, MarketingEvent>();
  for (const event of touched) byId.set(event.id, event);
  return { ...rest, degraded: [...new Set(degraded)], events: [...byId.values()] };
}
