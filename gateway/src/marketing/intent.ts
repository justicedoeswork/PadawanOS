/**
 * Austin's words → one Marketing Agent operation.
 *
 * Padawan orchestrates; the Marketing Agent reasons. So this module is
 * deliberately shallow: it decides WHICH of the agent's ten operations a
 * request is, pulls out the couple of parameters the agent's own schema
 * accepts (a trade, a competitor), and stops. It never assembles a marketing
 * answer, never ranks anything, never decides what "performing well" means —
 * every one of those belongs upstream, and a copy of it here would be a
 * second, quietly diverging implementation of marketing.
 *
 * Two rules it does enforce, because they are JusticeOS's to enforce:
 *
 *   - A decision is never executed from a sentence. "Approve this" maps to
 *     the decision operation, but comes back as a PROPOSAL that names the
 *     route and the payload and requires a deliberate confirmation. Approval
 *     is an action Austin takes, not an inference from something he said.
 *   - Research is always planned, never executed. The agent refuses to spend
 *     from this endpoint anyway; JusticeOS pins `dryRun: true` so that
 *     remains true even if that ever changes upstream.
 */
import { SERVICE_TRADES, type ServiceTrade } from './trades.js';

export type MarketingOperation =
  | 'health'
  | 'dataSources'
  | 'brief'
  | 'opportunities'
  | 'recommendations'
  | 'autonomy'
  | 'research'
  | 'prepareWork'
  | 'decisions'
  | 'tick'
  /** brief + data-source status, answered as one — "how is marketing performing?" needs both. */
  | 'performance';

export type DecisionType = 'APPROVE' | 'REJECT' | 'REQUEST_REVISION';

export interface ResearchParameters {
  readonly kind: 'WEBSITE' | 'WATCHLIST' | 'DEMAND';
  readonly competitor?: string;
  readonly trade?: ServiceTrade;
  readonly reason?: string;
}

export interface PrepareWorkParameters {
  readonly kind: 'PLAN_REVISION' | 'MARKETING_BRIEF' | 'WEBSITE_IMPROVEMENT_PACKAGE';
  readonly trade?: ServiceTrade;
  readonly reason?: string;
}

export interface DecisionParameters {
  readonly decision: DecisionType;
  /** Null when the sentence did not name one — the UI supplies it from the card Austin is acting on. */
  readonly revisionId: string | null;
}

/** An operation Padawan may run immediately: a read, or an action that cannot publish or spend. */
export interface ExecutableIntent {
  readonly kind: 'execute';
  readonly operation: MarketingOperation;
  readonly research?: ResearchParameters;
  readonly prepareWork?: PrepareWorkParameters;
  readonly opportunityTrade?: ServiceTrade;
  /** Why this operation was chosen, in one sentence, for the transcript and the audit trail. */
  readonly rationale: string;
}

/**
 * An operation that changes state and therefore needs a deliberate action.
 * Padawan renders this as a control, never as something it has already done.
 */
export interface ConfirmationRequiredIntent {
  readonly kind: 'needs-confirmation';
  readonly operation: 'decisions';
  readonly decision: DecisionParameters;
  readonly rationale: string;
  /** The exact JusticeOS route the confirmed action posts to. */
  readonly confirmVia: string;
}

/** Padawan could not tell what was being asked. It says so rather than guessing at a call. */
export interface UnroutableIntent {
  readonly kind: 'unroutable';
  readonly reason: string;
  readonly suggestions: readonly string[];
}

export type MarketingIntent = ExecutableIntent | ConfirmationRequiredIntent | UnroutableIntent;

const DECISION_ROUTE = '/api/marketing/agent/decisions';

const SUGGESTIONS: readonly string[] = [
  'What should we work on in marketing right now?',
  'What opportunities do we have?',
  'How is marketing performing?',
  "What's producing approved jobs?",
  'Research <competitor>.',
  'Prepare the <trade> website changes for approval.'
];

/** Spellings Austin actually uses, mapped onto the agent's own trade taxonomy. */
const TRADE_WORDS: readonly { readonly pattern: RegExp; readonly trade: ServiceTrade }[] = [
  { pattern: /\bgutters?\b|\bguttering\b/i, trade: 'GUTTERS' },
  { pattern: /\broof(ing|s)?\b/i, trade: 'ROOFING' },
  { pattern: /\bsiding\b/i, trade: 'SIDING' },
  { pattern: /\bsoffit\b|\bfascia\b/i, trade: 'SOFFIT_FASCIA' },
  { pattern: /\bexterior repair\b|\brepairs?\b/i, trade: 'EXTERIOR_REPAIR' },
  { pattern: /\bgeneral exterior\b|\bexteriors?\b/i, trade: 'GENERAL_EXTERIOR' }
];

export function tradeIn(text: string): ServiceTrade | null {
  for (const { pattern, trade } of TRADE_WORDS) {
    if (pattern.test(text)) return trade;
  }
  return null;
}

/** Normalizes a caller-supplied trade string; anything outside the taxonomy is rejected rather than coerced. */
export function asServiceTrade(raw: unknown): ServiceTrade | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  return (SERVICE_TRADES as readonly string[]).includes(upper) ? (upper as ServiceTrade) : null;
}

/**
 * The competitor a research request names. Only ever a narrowing: the
 * Marketing Agent will not add an unknown competitor to its watchlist, and
 * this does not pretend otherwise — a name it cannot find simply means the
 * agent plans across everything already approved.
 */
function competitorIn(text: string): string | null {
  const domain = text.match(/\b((?:[a-z0-9-]+\.)+[a-z]{2,})\b/i);
  if (domain?.[1]) return domain[1].toLowerCase();

  const named = text.match(/\bresearch(?:\s+(?:this|the|our))?\s+competitor\s+([^.?!,]+)/i) ?? text.match(/\bresearch\s+([^.?!,]+)/i);
  const candidate = named?.[1]?.trim();
  if (!candidate) return null;

  // "research this competitor" / "research the market" name nothing in
  // particular — treat them as an unnarrowed request rather than inventing a
  // competitor called "this competitor".
  if (/^(this|that|the|our|a|an)?\s*(competitor|competition|market|demand|website|watchlist|them|it)s?$/i.test(candidate)) return null;
  return candidate;
}

function hasAll(text: string, ...words: readonly string[]): boolean {
  return words.every((word) => new RegExp(word, 'i').test(text));
}

/**
 * Asking is not deciding. A trailing question mark, or an opening
 * interrogative, is treated as a question — deliberately generous, because
 * every false positive here costs a clarifying round-trip and every false
 * negative would be a decision nobody made.
 */
function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text) || /^\s*(what|which|who|when|where|why|how|is|are|do|does|did|can|could|should|would|will|has|have|am)\b/i.test(text);
}

/**
 * Routes one request. Order matters: the most specific and most consequential
 * patterns are tested first, so "prepare the gutter website changes for
 * approval" cannot be swallowed by the much looser "approval" test that
 * follows it.
 */
export function routeMarketingIntent(rawRequest: string): MarketingIntent {
  const text = rawRequest.trim();
  if (text.length === 0) {
    return { kind: 'unroutable', reason: 'Nothing was asked.', suggestions: SUGGESTIONS };
  }

  // ── Preparing work ──────────────────────────────────────────────────────
  // Before every decision pattern: this sentence contains "approval" and
  // means the opposite of approving anything.
  if (/\b(prepare|draft|put together|write up)\b/i.test(text)) {
    const trade = tradeIn(text);
    if (/\bwebsite\b|\bpage\b|\bcopy\b|\bsite\b/i.test(text)) {
      return {
        kind: 'execute',
        operation: 'prepareWork',
        prepareWork: { kind: 'WEBSITE_IMPROVEMENT_PACKAGE', ...(trade ? { trade } : {}), reason: text },
        rationale: trade
          ? `Prepare an owner-review website package for ${trade}. Nothing is published by preparing it.`
          : 'Prepare an owner-review website package. Nothing is published by preparing it.'
      };
    }
    if (/\bbrief\b/i.test(text)) {
      return { kind: 'execute', operation: 'prepareWork', prepareWork: { kind: 'MARKETING_BRIEF', reason: text }, rationale: 'Prepare a marketing brief and hand it to the Communications Agent.' };
    }
    return { kind: 'execute', operation: 'prepareWork', prepareWork: { kind: 'PLAN_REVISION', reason: text }, rationale: 'Propose a plan revision. It changes nothing until Austin decides.' };
  }

  // ── Decisions (never executed from a sentence) ──────────────────────────
  // A question is never a decision, not even a question with "approve" in it.
  // Two things hang on this. "What's producing approved jobs?" is a request
  // for attribution evidence and uses the word as an adjective; and "should I
  // approve this?" is Austin thinking out loud, which must not turn into a
  // decision control appearing as though he had chosen one.
  const decisionWorded = /\b(approv|reject|revis)/i.test(text);
  if (isQuestion(text)) {
    if (decisionWorded && !/\b(producing|generating|driving|source of|attribut)\b/i.test(text)) {
      return {
        kind: 'unroutable',
        reason:
          'That reads as a question about a decision rather than a decision. Approving, rejecting and requesting a revision are deliberate actions taken on one named package — ask for the package, then act on it there.',
        suggestions: SUGGESTIONS
      };
    }
  } else {
    if (/\b(approve|approved|sign off|go ahead with it|ship it)\b/i.test(text)) {
      return decisionProposal('APPROVE', text, 'Approving is a deliberate action — this is the decision it would record, not a decision that has been made.');
    }
    if (/\b(reject|rejected|decline|turn (it )?down|no,? don'?t)\b/i.test(text)) {
      return decisionProposal('REJECT', text, 'Rejecting is a deliberate action — this is the decision it would record.');
    }
    if (/\b(revise|revision|rework|change(s)? to it|another pass|redo)\b/i.test(text)) {
      return decisionProposal('REQUEST_REVISION', text, 'Requesting a revision leaves the proposal pending and records the changes asked for.');
    }
  }

  // ── Research ────────────────────────────────────────────────────────────
  if (/\b(research|look (in)?to|check on|investigate|scrape|crawl)\b/i.test(text)) {
    const competitor = competitorIn(text);
    const trade = tradeIn(text);
    const kind = /\bdemand\b|\bmarket\b|\bsearch volume\b/i.test(text) ? 'DEMAND' : /\bwatchlist\b|\brecheck\b/i.test(text) ? 'WATCHLIST' : 'WEBSITE';
    return {
      kind: 'execute',
      operation: 'research',
      research: { kind, ...(competitor ? { competitor } : {}), ...(trade ? { trade } : {}), reason: text },
      rationale: 'Ask the agent what research is due. Planning only — nothing is fetched and nothing is spent.'
    };
  }

  // ── Reads ───────────────────────────────────────────────────────────────
  if (hasAll(text, '\\bopportunit')) {
    const trade = tradeIn(text);
    return { kind: 'execute', operation: 'opportunities', ...(trade ? { opportunityTrade: trade } : {}), rationale: 'Read the scored demand-capture opportunities from stored evidence.' };
  }
  if (/\b(producing|generating|driving|source of|attribut|converting|closed|won)\b/i.test(text) && /\b(jobs?|leads?|revenue|sales|work)\b/i.test(text)) {
    return {
      kind: 'execute',
      operation: 'recommendations',
      rationale: "Read the agent's ranked work and its outcome evidence — it owns which channels are producing approved jobs."
    };
  }
  if (/\b(performing|performance|how(?:'s| is| are) marketing|doing|trend)\b/i.test(text)) {
    return { kind: 'execute', operation: 'performance', rationale: 'Read the current brief together with the status of every source it was built from.' };
  }
  if (/\b(autonom|allowed to|permitted|boundar|what can (you|it) do)\b/i.test(text)) {
    return { kind: 'execute', operation: 'autonomy', rationale: "Read the agent's own limits." };
  }
  if (/\b(healthy|health|is it (up|running|working)|status|degraded|broken)\b/i.test(text)) {
    return { kind: 'execute', operation: 'health', rationale: 'Read the agent’s health and whether its loop is still ticking.' };
  }
  if (/\b(data sources?|connected|integrations?|freshness|stale)\b/i.test(text)) {
    return { kind: 'execute', operation: 'dataSources', rationale: 'Read every evidence source with its connection state and freshness.' };
  }
  if (/\b(work on|focus on|priorit|next|brief|today|should we)\b/i.test(text)) {
    return { kind: 'execute', operation: 'brief', rationale: 'Read the current marketing brief — the agent’s own answer to what to work on.' };
  }
  if (/\b(recommend|suggest|ranked|what.*should.*do)\b/i.test(text)) {
    return { kind: 'execute', operation: 'recommendations', rationale: 'Read the agent’s ranked marketing work.' };
  }

  return {
    kind: 'unroutable',
    reason: 'Padawan could not tell which marketing question this is, and will not guess at a call that might cost money.',
    suggestions: SUGGESTIONS
  };
}

function decisionProposal(decision: DecisionType, text: string, rationale: string): ConfirmationRequiredIntent {
  return {
    kind: 'needs-confirmation',
    operation: 'decisions',
    decision: { decision, revisionId: revisionIdIn(text) },
    rationale,
    confirmVia: DECISION_ROUTE
  };
}

/**
 * A revision id if the sentence actually contains one. "This" and "it" are
 * not identifiers: leaving it null forces the caller to say which package it
 * means, which is exactly the ambiguity that must not be resolved by
 * guessing.
 */
function revisionIdIn(text: string): string | null {
  const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  return uuid?.[0]?.toLowerCase() ?? null;
}
