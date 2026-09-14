/**
 * Production-only startup gate. In development/test, none of this
 * runs -- see the isProduction check at the single call site in
 * server.ts -- so the convenient throwaway config every test and
 * `pnpm dev` run relies on (a short test secret, a plain
 * PADAWAN_GATEWAY_PASSWORD, ws://127.0.0.1 upstream URLs) is
 * completely unaffected.
 *
 * In production, a missing or weak value here used to only log an
 * error and continue running half-broken; it now refuses to start at
 * all, with every problem reported at once rather than one restart
 * per fix.
 */

/**
 * A true entropy measurement isn't reliably automatable for an
 * arbitrary configured string. Length is used as a practical proxy:
 * 32 characters is what `crypto.randomBytes(16).toString('hex')`
 * produces, and the .env.example's own suggested generator
 * (randomBytes(32).toString('hex')) produces 64 -- 32 is a floor well
 * below that recommendation, not the target.
 */
const MIN_SECRET_LENGTH = 32;

export interface ProductionConfigInput {
  gatewayPassword: string | null;
  gatewayPasswordHash: string | null;
  sessionSecret: string | null;
  acpGatewayServiceKey: string | null;
  allowedOrigins: string[];
  insuranceAgentAcpUrl: string | null;
  allowedUserId: string | null;
  allowedRealmId: string | null;
}

/**
 * Catches an obvious copy-pasted example value rather than a real
 * secret -- gateway/.env.example's own PADAWAN_SESSION_SECRET
 * placeholder ("replace-me-with-a-random-64-char-hex-string") is
 * deliberately long and descriptive for a human reading the file, but
 * that same length would otherwise sail past the MIN_SECRET_LENGTH
 * check below if someone deployed the example file verbatim. A real
 * random hex/base64 secret has no meaningful chance of containing any
 * of these words, so this heuristic has no real false-positive risk.
 */
const PLACEHOLDER_PATTERN = /replace[-_]?me|change[-_]?me|your[-_]?(password|secret|key)|example|placeholder|xxxxxxxx/i;

function looksLikePlaceholder(value: string): boolean {
  return PLACEHOLDER_PATTERN.test(value);
}

function isHttpsOrigin(origin: string): boolean {
  try {
    return new URL(origin).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * "Explicitly approved as a private/internal destination": Fly's own
 * convention for private inter-app networking is the `.internal`
 * suffix, resolvable only inside the same Fly org's 6PN network and
 * never from the public internet -- exactly the property Phase 1 (the
 * Insurance Agent's private ACP listener) depends on. 127.0.0.1 and
 * localhost are accepted too, since production validation should
 * still allow a deliberate same-host deployment; anything else
 * (including the Insurance Agent's own PUBLIC insurance-audit-agent.
 * fly.dev hostname -- the exact surface Phase 1 closed off) is
 * rejected.
 */
function isApprovedPrivateAcpUrl(rawUrl: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return false;
  }

  const hostname = parsed.hostname.toLowerCase();

  return hostname.endsWith('.internal') || hostname === '127.0.0.1' || hostname === 'localhost';
}

/**
 * Returns every problem found (empty array = OK) rather than throwing
 * directly -- the call site decides whether to throw, which is what
 * makes this independently unit-testable without needing to catch an
 * exception for every case.
 */
export function findProductionConfigProblems(input: ProductionConfigInput): string[] {
  const problems: string[] = [];

  if (input.gatewayPassword) {
    problems.push(
      'PADAWAN_GATEWAY_PASSWORD (plaintext) must not be set in production -- configure PADAWAN_GATEWAY_PASSWORD_HASH instead.'
    );
  }

  if (!input.gatewayPasswordHash) {
    problems.push('PADAWAN_GATEWAY_PASSWORD_HASH is required in production.');
  } else if (looksLikePlaceholder(input.gatewayPasswordHash)) {
    problems.push('PADAWAN_GATEWAY_PASSWORD_HASH looks like an example/placeholder value, not a real generated hash.');
  }

  if (!input.sessionSecret || input.sessionSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`PADAWAN_SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters in production.`);
  } else if (looksLikePlaceholder(input.sessionSecret)) {
    problems.push(
      'PADAWAN_SESSION_SECRET looks like an example/placeholder value (e.g. copied from .env.example) rather than a real generated secret.'
    );
  }

  if (!input.acpGatewayServiceKey || input.acpGatewayServiceKey.length < MIN_SECRET_LENGTH) {
    problems.push(`ACP_GATEWAY_SERVICE_KEY must be at least ${MIN_SECRET_LENGTH} characters in production.`);
  } else if (looksLikePlaceholder(input.acpGatewayServiceKey)) {
    problems.push('ACP_GATEWAY_SERVICE_KEY looks like an example/placeholder value, not a real generated secret.');
  }

  if (!input.allowedOrigins.some(isHttpsOrigin)) {
    problems.push('At least one exact HTTPS origin must be configured in PADAWAN_ALLOWED_ORIGINS in production.');
  }

  if (!input.insuranceAgentAcpUrl) {
    problems.push('INSURANCE_AGENT_ACP_URL is required in production.');
  } else if (!isApprovedPrivateAcpUrl(input.insuranceAgentAcpUrl)) {
    problems.push(
      'INSURANCE_AGENT_ACP_URL must be a ws(s):// URL to an approved private/internal destination (a .internal hostname, 127.0.0.1, or localhost) in production -- never a public hostname.'
    );
  }

  if (!input.allowedUserId) {
    problems.push('ACP_ALLOWED_USER_ID is required in production.');
  } else if (looksLikePlaceholder(input.allowedUserId)) {
    problems.push('ACP_ALLOWED_USER_ID looks like an example/placeholder value, not a real user id.');
  }

  if (!input.allowedRealmId) {
    problems.push('ACP_ALLOWED_REALM_ID is required in production.');
  } else if (looksLikePlaceholder(input.allowedRealmId)) {
    problems.push('ACP_ALLOWED_REALM_ID looks like an example/placeholder value, not a real realm id.');
  }

  return problems;
}

/** Throws with every problem listed if any is found. Never includes secret values in the message -- only which variable is missing/weak and why. */
export function assertProductionConfigIsValid(input: ProductionConfigInput): void {
  const problems = findProductionConfigProblems(input);

  if (problems.length > 0) {
    throw new Error(
      `Refusing to start in production due to ${problems.length} configuration problem(s):\n` +
        problems.map((problem) => `  - ${problem}`).join('\n')
    );
  }
}
