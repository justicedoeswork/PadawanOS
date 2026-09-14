/** Build-time constant injected from package.json's version (vite.config.ts
 * `define`) — the version the settings page displays; identical across web
 * and desktop because both ship the same Vite build. */
declare const __APP_VERSION__: string;

/** True for the production gateway build, false for the GitHub Pages demo
 * build (vite.config.ts `define`, driven by the JUSTICEOS_BUILD_MODE env var —
 * see src/gateway/buildMode.ts). */
declare const __GATEWAY_BUILD__: boolean;
