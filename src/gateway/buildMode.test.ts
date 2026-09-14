import { afterEach, describe, expect, it } from 'vitest';
import { __setBuildMode, buildMode, isGatewayBuild } from './buildMode';

afterEach(() => {
  __setBuildMode(null);
});

describe('buildMode', () => {
  it('defaults to the compiled build mode (demo, since PANDA_BUILD_MODE is unset for the test run)', () => {
    expect(buildMode()).toBe('demo');
    expect(isGatewayBuild()).toBe(false);
  });

  it('the test seam overrides the mode', () => {
    __setBuildMode('gateway');
    expect(buildMode()).toBe('gateway');
    expect(isGatewayBuild()).toBe(true);
  });

  it('passing null to the test seam restores the compiled default', () => {
    __setBuildMode('gateway');
    __setBuildMode(null);
    expect(buildMode()).toBe('demo');
    expect(isGatewayBuild()).toBe(false);
  });
});
