/**
 * Non-secret build-mode switch (Phase 3, requirement #13): distinguishes the
 * production gateway build (served by the JusticeOS gateway, behind the
 * login gate, auto-connecting the managed Insurance Agent) from the
 * GitHub Pages demo build (the existing public deploy.yml target — a plain
 * `vite build` with no gateway behind it).
 *
 * `__GATEWAY_BUILD__` is a compile-time constant (vite.config.ts `define`,
 * same mechanism as `__APP_VERSION__`) driven by an env var at build time —
 * it carries no secret, just which shape of app got built. deploy.yml never
 * sets that env var, so the GitHub Pages build always compiles to `false`
 * regardless of anything at runtime (requirement #14).
 *
 * Runtime code reads through `isGatewayBuild()`/`buildMode()` rather than the
 * raw constant so tests can flip it without depending on how the test file
 * itself was compiled — same test-seam pattern as __setPermissionPolicy /
 * __setTestTransportFactory elsewhere in this codebase.
 */
export type BuildMode = 'gateway' | 'demo';

const compiledDefault: BuildMode = __GATEWAY_BUILD__ ? 'gateway' : 'demo';

let current: BuildMode = compiledDefault;

export function buildMode(): BuildMode {
  return current;
}

/** True for the production gateway build; false for the GitHub Pages demo build. */
export function isGatewayBuild(): boolean {
  return current === 'gateway';
}

/** Test seam: override the build mode; null restores the compiled default. */
export function __setBuildMode(mode: BuildMode | null): void {
  current = mode ?? compiledDefault;
}
