/**
 * The agents JusticeOS knows about.
 *
 * Until now there was no registry at all: the Insurance Agent existed as a
 * hard-coded ACP profile id and the Marketing Agent as a hard-coded route
 * prefix, and the only place either was "declared" was the sidebar that drew
 * a button for it. That is fine for a picker and useless for an orchestrator
 * — Padawan has to be able to answer "who could do this, and are they even
 * allowed to?" before it routes anything.
 *
 * So this is a registry in the narrow sense that matters here: each agent's
 * name, how JusticeOS reaches it, what it can be asked for, and — the part
 * that actually changes behaviour — the autonomy boundary it operates under.
 * Padawan reads `autonomy` to decide whether an intent can be executed or
 * must be turned into an approval request. It is deliberately data, not
 * behaviour: nothing here calls anything.
 */

export type AgentTransport = 'ACP_WEBSOCKET' | 'HTTP_AGENT_CONTRACT' | 'NONE';

/**
 * What an agent may do on its own, in JusticeOS's words. This mirrors the
 * Marketing Agent's own three-band policy (`GET /agent/autonomy`) rather
 * than inventing a second vocabulary — JusticeOS's copy exists so Padawan
 * can refuse an intent BEFORE spending a call on it, and the agent's own
 * live policy is still the authority when they disagree.
 */
export interface AgentAutonomy {
  /** Performed unattended, no approval, no notification required. */
  readonly automatic: readonly string[];
  /** The agent may prepare it and stops. A recorded owner decision is the only thing that moves it. */
  readonly ownerApprovalRequired: readonly string[];
  /** Not done at all, approval or no approval. */
  readonly never: readonly string[];
}

export interface RegisteredAgent {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly transport: AgentTransport;
  /** Where JusticeOS reaches it, as a same-origin path. Never an upstream URL — those live in config and never leave the server. */
  readonly basePath: string | null;
  readonly capabilities: readonly string[];
  readonly autonomy: AgentAutonomy;
  /** The answer-envelope contract version JusticeOS was built against, when the agent has one. */
  readonly contractVersion: string | null;
  /**
   * True when the agent can act without being asked. Padawan uses this to
   * decide whether "nothing has happened" is news (an autonomous agent that
   * has gone quiet is a problem) or simply the normal state.
   */
  readonly autonomous: boolean;
}

export const INSURANCE_AGENT_ID = 'insurance-audit';
export const MARKETING_AGENT_ID = 'marketing';

/**
 * The Marketing Agent, as a first-class JusticeOS agent.
 *
 * The capability list is what Padawan matches an intent against; the autonomy
 * bands are what stop it from promising something the agent will refuse. The
 * single most load-bearing line in this file is in `never`: this agent does
 * not publish and does not spend beyond its configured budget, so Padawan
 * must never offer to make it do either, however the request is phrased.
 */
export const MARKETING_AGENT: RegisteredAgent = {
  id: MARKETING_AGENT_ID,
  name: 'Marketing Agent',
  summary:
    'Owns marketing reasoning for Justice Exteriors: what the market wants, what competitors are doing, what the website and analytics say, what worked, and what to do next. It prepares work and stops.',
  transport: 'HTTP_AGENT_CONTRACT',
  basePath: '/api/marketing/agent',
  capabilities: [
    'marketing intelligence',
    'demand analysis',
    'competitor research',
    'website research',
    'analytics analysis',
    'outcome attribution',
    'opportunity identification',
    'marketing planning',
    'draft preparation',
    'approval-package preparation'
  ],
  autonomy: {
    automatic: [
      'read stored marketing evidence',
      'sync first-party analytics (GA4, Search Console, AccuLynx)',
      'research within its configured rules, budget and cooldowns',
      'analyse and re-score opportunities',
      'prepare drafts and plan revisions',
      'create internal recommendations',
      'emit internal marketing events'
    ],
    ownerApprovalRequired: [
      'public website changes',
      'social publishing',
      'advertising launch',
      'changing ad spend',
      'customer-facing marketing communications',
      'changing public business facts',
      'applying a proposed marketing plan revision',
      'widening the paid collection (markets, grid points, tracked queries)'
    ],
    never: [
      'publish content',
      'modify the live website',
      'contact a customer',
      'spend beyond its configured budget',
      'rewrite stored observations',
      'change verified business facts'
    ]
  },
  contractVersion: '1',
  autonomous: true
};

/**
 * The Insurance Audit Agent. Registered for completeness — its integration
 * predates this registry and still runs entirely over the ACP WebSocket
 * proxy, so it has no answer-envelope contract and no autonomy declaration
 * of its own to mirror here. Saying "unknown" is better than inventing one.
 */
export const INSURANCE_AGENT: RegisteredAgent = {
  id: INSURANCE_AGENT_ID,
  name: 'Insurance Audit Agent',
  summary: 'Conversational insurance audit work, reached over the authenticated ACP WebSocket proxy.',
  transport: 'ACP_WEBSOCKET',
  basePath: '/acp/insurance',
  capabilities: ['insurance audit', 'claim review', 'document analysis'],
  autonomy: { automatic: [], ownerApprovalRequired: [], never: [] },
  contractVersion: null,
  autonomous: false
};

export const AGENT_REGISTRY: readonly RegisteredAgent[] = [INSURANCE_AGENT, MARKETING_AGENT];

export function findAgent(id: string): RegisteredAgent | null {
  return AGENT_REGISTRY.find((agent) => agent.id === id) ?? null;
}

/**
 * Whether this agent is allowed to carry out `capability` unattended.
 * "Unknown capability" answers false, which is the whole point: Padawan
 * asking about something the registry has never heard of must not be told
 * yes.
 */
export function isAutomaticFor(agent: RegisteredAgent, capability: string): boolean {
  const needle = capability.trim().toLowerCase();
  return agent.autonomy.automatic.some((entry) => entry.toLowerCase() === needle);
}
