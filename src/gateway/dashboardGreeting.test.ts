import { describe, expect, it } from 'vitest';
import { greetingPeriodForHour } from './dashboardGreeting';

describe('greetingPeriodForHour', () => {
  it('is morning from 5am up to (not including) noon', () => {
    expect(greetingPeriodForHour(5)).toBe('morning');
    expect(greetingPeriodForHour(9)).toBe('morning');
    expect(greetingPeriodForHour(11)).toBe('morning');
  });

  it('is afternoon from noon up to (not including) 5pm', () => {
    expect(greetingPeriodForHour(12)).toBe('afternoon');
    expect(greetingPeriodForHour(14)).toBe('afternoon');
    expect(greetingPeriodForHour(16)).toBe('afternoon');
  });

  it('is evening from 5pm through the small hours, wrapping past midnight', () => {
    expect(greetingPeriodForHour(17)).toBe('evening');
    expect(greetingPeriodForHour(23)).toBe('evening');
    expect(greetingPeriodForHour(0)).toBe('evening');
    expect(greetingPeriodForHour(4)).toBe('evening');
  });
});
