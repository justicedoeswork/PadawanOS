/**
 * Who is asking, on behalf of what, and how JusticeOS keeps two of the same
 * question from being paid for twice.
 *
 * The Marketing Agent's contract accepts exactly three pieces of caller
 * identity: an `Idempotency-Key` header (which it also uses as the request id
 * in its own logs), an `actor` on the two mutating operations, and a free-text
 * `reason`. It has no conversation or task field. So JusticeOS propagates its
 * own identifiers in `X-JusticeOS-*` headers — carried, logged at both ends,
 * ignored by the agent today, and available the moment the contract grows a
 * field for them — and it enforces de-duplication ITSELF, here, rather than
 * hoping the upstream will.
 *
 * That last point is the one that matters. `POST /agent/research` plans
 * rather than fetches, so a duplicate is cheap today; `POST /agent/tick` is
 * not, and the whole reason the agent has DB leases is that something
 * upstream of it will eventually ask twice. JusticeOS asking twice by
 * accident — a double-click, a retried fetch, two Padawan turns about the
 * same thing — is a JusticeOS bug, and it is fixed on this side of the wire.
 */
import crypto from 'node:crypto';

/** The JusticeOS-side identity carried on every Marketing Agent call. */
export interface RequestContext {
  /** The Padawan conversation this came from, when there is one. */
  readonly conversationId: string | null;
  /** The unit of work Austin would recognise as "that thing I asked for". */
  readonly taskId: string | null;
  /** Which JusticeOS component is asking. Always set — an unattributed call is a call nobody owns. */
  readonly requestingAgent: string;
  /** The operator identity recorded upstream. Asserted by the gateway, never accepted from the browser. */
  readonly actor: string | null;
}

export const PADAWAN_AGENT_ID = 'padawan';

export const CONVERSATION_HEADER = 'x-justiceos-conversation-id';
export const TASK_HEADER = 'x-justiceos-task-id';
export const REQUESTING_AGENT_HEADER = 'x-justiceos-requesting-agent';
export const CONTRACT_VERSION_HEADER = 'x-justiceos-contract-version';

/** Ids are opaque and short. A caller-supplied one is accepted only if it looks like an id, never echoed raw into anything. */
export function sanitizeId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return null;
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

/** A fresh task id for a unit of work the caller did not name. */
export function newTaskId(): string {
  return `task_${crypto.randomUUID()}`;
}

export function headersFor(context: RequestContext, expectedContractVersion: string): Record<string, string> {
  const headers: Record<string, string> = {
    [REQUESTING_AGENT_HEADER]: context.requestingAgent,
    [CONTRACT_VERSION_HEADER]: expectedContractVersion
  };
  if (context.conversationId) headers[CONVERSATION_HEADER] = context.conversationId;
  if (context.taskId) headers[TASK_HEADER] = context.taskId;
  return headers;
}

/**
 * The identity of "this exact request".
 *
 * Deliberately NOT scoped to the conversation: Austin asking for the same
 * competitor research in two different Padawan threads is still one piece of
 * research, and charging for it twice because the threads differ would be
 * indefensible. It is scoped to the operation and its parameters, and
 * nothing else.
 */
export function idempotencyKeyFor(operation: string, parameters: unknown): string {
  const canonical = canonicalize(parameters);
  const digest = crypto.createHash('sha256').update(`${operation}\u0000${canonical}`).digest('hex').slice(0, 32);
  return `justiceos-${operation}-${digest}`;
}

/** Stable JSON: object keys sorted, so `{a,b}` and `{b,a}` are one request rather than two. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(',')}}`;
}

export interface DedupeOutcome<T> {
  readonly value: T;
  /** True when this answer came from an in-flight or recently-completed identical request rather than a new upstream call. */
  readonly deduped: boolean;
  /** The task id of the request that actually did the work, when this one did not. */
  readonly originalTaskId: string | null;
}

interface Entry<T> {
  readonly taskId: string | null;
  readonly promise: Promise<T>;
  settledAt: number | null;
}

/**
 * Single-flight plus a short replay window, in process memory.
 *
 * In process, because the gateway is one Fly machine and holds no database —
 * saying so plainly is better than implying a stronger guarantee than there
 * is. Two machines would each keep their own window; the Marketing Agent's
 * own DB leases and idempotency keys remain the durable backstop, and that
 * layering is deliberate rather than accidental.
 *
 * A failed call is NOT cached: a network blip must not pin a "no" in front of
 * the next ten minutes of requests.
 */
export class RequestDeduper {
  private readonly entries = new Map<string, Entry<unknown>>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  async run<T>(key: string, taskId: string | null, work: () => Promise<T>): Promise<DedupeOutcome<T>> {
    this.evictExpired();

    const existing = this.entries.get(key) as Entry<T> | undefined;
    if (existing) {
      return { value: await existing.promise, deduped: true, originalTaskId: existing.taskId };
    }

    const entry: Entry<T> = { taskId, promise: work(), settledAt: null };
    this.entries.set(key, entry as Entry<unknown>);

    try {
      const value = await entry.promise;
      entry.settledAt = this.now();
      return { value, deduped: false, originalTaskId: taskId };
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }

  private evictExpired(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.settledAt !== null && entry.settledAt <= cutoff) this.entries.delete(key);
    }
  }

  /** Test seam only. */
  clear(): void {
    this.entries.clear();
  }
}
