/**
 * In-memory per-IP login throttle. There is exactly one account and
 * this runs as a single instance (unlike the multi-machine Insurance
 * Agent), so in-memory state is the right amount of infrastructure --
 * no shared store needed. Every outcome (right or wrong password) is
 * handled by the same code path in auth.ts with the same generic
 * response, so a throttled or rejected attempt never reveals whether
 * an account "exists" -- there is only ever the one, un-enumerable
 * credential.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function currentBucket(ip: string): Bucket {
  const existing = buckets.get(ip);
  const now = Date.now();

  if (existing && now - existing.windowStart < WINDOW_MS) {
    return existing;
  }

  const fresh: Bucket = { count: 0, windowStart: now };
  buckets.set(ip, fresh);
  return fresh;
}

export function isThrottled(ip: string): boolean {
  return currentBucket(ip).count >= MAX_ATTEMPTS_PER_WINDOW;
}

export function recordFailedAttempt(ip: string): void {
  const bucket = currentBucket(ip);
  bucket.count += 1;
}

export function recordSuccessfulLogin(ip: string): void {
  buckets.delete(ip);
}

/** Test-only: throttle state must not leak between unrelated test cases. */
export function resetLoginThrottleForTests(): void {
  buckets.clear();
}
