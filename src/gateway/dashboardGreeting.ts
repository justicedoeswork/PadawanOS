/**
 * Device-local-time greeting for the JusticeOS dashboard home screen.
 * Pure function (no Date.now() call baked in) so it's trivially testable
 * across the whole day without faking the system clock -- callers pass
 * `new Date().getHours()` (or a fixed hour in tests).
 */
export type GreetingPeriod = 'morning' | 'afternoon' | 'evening';

/** 5:00-11:59 morning, 12:00-16:59 afternoon, everything else evening --
 * boundaries chosen for typical waking hours, not tied to any business
 * schedule. */
export function greetingPeriodForHour(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  return 'evening';
}
