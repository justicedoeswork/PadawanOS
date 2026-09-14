/**
 * In-memory per-IP login throttle. There is exactly one account and
 * this runs as a single instance (unlike the multi-machine Insurance
 * Agent), so in-memory state is the right amount of infrastructure --
 * no shared store needed. Every outcome (right or wrong password) is
 * handled by the same code path in auth.ts with the same generic
 * response, so a throttled or rejected attempt never reveals whether
 * an account "exists" -- there is only ever the one, un-enumerable
 * credential.
 *
 * Bounded on two axes so this can never become an unbounded-memory
 * vector:
 *  - every access purges every expired bucket first (cheap at the
 *    realistic scale of a single-owner endpoint -- at most a handful
 *    of real IPs, so an O(n) sweep on each attempt costs nothing
 *    worth a background timer), so an IP that stops being queried
 *    still has its bucket dropped the next time ANY IP is checked.
 *  - the total number of distinct IPs tracked at once is capped;
 *    many unique attacking IPs within one window (so purging expired
 *    entries alone wouldn't free anything) evict the single oldest
 *    entry to make room rather than growing without limit.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;

/**
 * A single owner's login endpoint realistically sees traffic from a
 * handful of real addresses (home, phone, maybe a VPN exit) at once.
 * This is generous headroom above that for legitimate use while still
 * bounding worst-case memory from many distinct attacking IPs to a
 * few tens of KB.
 */
const MAX_TRACKED_IPS = 1000;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

function isExpired(bucket: Bucket, now: number): boolean {
  return now - bucket.windowStart >= WINDOW_MS;
}

function purgeExpired(now: number): void {
  for (const [ip, bucket] of buckets) {
    if (isExpired(bucket, now)) {
      buckets.delete(ip);
    }
  }
}

/** If still at capacity after purging expired entries, evict the single oldest bucket to make room -- never silently refuses to track a new IP, which would let it bypass throttling entirely. */
function evictOldestIfNeeded(): void {
  if (buckets.size < MAX_TRACKED_IPS) return;

  let oldestIp: string | null = null;
  let oldestWindowStart = Infinity;

  for (const [ip, bucket] of buckets) {
    if (bucket.windowStart < oldestWindowStart) {
      oldestWindowStart = bucket.windowStart;
      oldestIp = ip;
    }
  }

  if (oldestIp !== null) {
    buckets.delete(oldestIp);
  }
}

function currentBucket(ip: string): Bucket {
  const now = Date.now();
  purgeExpired(now);

  const existing = buckets.get(ip);
  if (existing) {
    return existing; // purgeExpired just ran, so this is known-fresh
  }

  evictOldestIfNeeded();

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

/** Test-only: inspect current bucket count without affecting state. */
export function trackedIpCountForTests(): number {
  return buckets.size;
}

/** Test-only: throttle state must not leak between unrelated test cases. */
export function resetLoginThrottleForTests(): void {
  buckets.clear();
}
