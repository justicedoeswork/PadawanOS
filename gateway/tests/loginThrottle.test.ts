import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isThrottled, recordFailedAttempt, trackedIpCountForTests, resetLoginThrottleForTests } from '../src/loginThrottle.js';

// Mirrors loginThrottle.ts's own private constants -- there is nothing
// to import them from, so they're restated here for the test's own
// arithmetic (window expiry, attempt count) rather than guessed at.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const MAX_TRACKED_IPS = 1000;

beforeEach(() => {
  resetLoginThrottleForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('login throttle', () => {
  it('throttles after the configured number of failed attempts within the window', () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW; i++) {
      expect(isThrottled('1.2.3.4')).toBe(false);
      recordFailedAttempt('1.2.3.4');
    }
    expect(isThrottled('1.2.3.4')).toBe(true);
  });

  it('purges an expired bucket so throttling lifts, with a genuinely fresh count, once the window passes', () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW; i++) recordFailedAttempt('5.6.7.8');
    expect(isThrottled('5.6.7.8')).toBe(true);
    expect(trackedIpCountForTests()).toBe(1);

    vi.advanceTimersByTime(WINDOW_MS + 1);

    // The stale bucket is purged rather than merely aged out in place.
    expect(isThrottled('5.6.7.8')).toBe(false);

    // Proves the replacement bucket is genuinely fresh (count 0), not
    // a stale one that happens to still read `false` -- it takes a
    // full new round of failures to throttle again.
    for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW - 1; i++) {
      recordFailedAttempt('5.6.7.8');
      expect(isThrottled('5.6.7.8')).toBe(false);
    }
    recordFailedAttempt('5.6.7.8');
    expect(isThrottled('5.6.7.8')).toBe(true);
  });

  it('purging an unrelated expired bucket does not affect an unrelated, still-fresh IP', () => {
    for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW; i++) recordFailedAttempt('5.6.7.8');
    vi.advanceTimersByTime(WINDOW_MS + 1);

    // Any access purges every expired bucket, not just the one being queried.
    recordFailedAttempt('9.9.9.9');
    expect(isThrottled('9.9.9.9')).toBe(false);
    expect(trackedIpCountForTests()).toBe(1); // 5.6.7.8's stale bucket was purged, not carried forward
  });

  it('bounds the number of distinct tracked IPs, evicting the oldest bucket rather than growing without limit', () => {
    for (let i = 0; i < MAX_TRACKED_IPS; i++) {
      recordFailedAttempt(`10.${Math.floor(i / 65536)}.${Math.floor(i / 256) % 256}.${i % 256}`);
      vi.advanceTimersByTime(1); // distinct windowStart per IP so "oldest" is well-defined
    }
    expect(trackedIpCountForTests()).toBe(MAX_TRACKED_IPS);

    // One more distinct IP must not be allowed to grow storage past the cap.
    recordFailedAttempt('192.168.1.1');
    expect(trackedIpCountForTests()).toBe(MAX_TRACKED_IPS);

    // The very first (oldest) bucket was evicted to make room -- its
    // count is back to a fresh, untouched state rather than remembered.
    expect(isThrottled('10.0.0.0')).toBe(false);
    for (let i = 0; i < MAX_ATTEMPTS_PER_WINDOW - 1; i++) recordFailedAttempt('10.0.0.0');
    expect(isThrottled('10.0.0.0')).toBe(false); // still under the limit on its fresh bucket
  });
});
