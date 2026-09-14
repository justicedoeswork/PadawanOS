import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// The settings page displays the release version; inject it from package.json
// at build time so web and desktop (one shared build) can never disagree.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

// Non-secret build-mode switch (Phase 3, gateway hardening follow-up): unset
// (or anything but 'gateway') always compiles to the GitHub Pages demo build
// -- deploy.yml's plain `vite build` never sets this, so Pages can never
// accidentally ship the gateway-connected build. `pnpm build:gateway` sets it
// for the one build that's actually deployed behind the gateway.
const isGatewayBuild = process.env.JUSTICEOS_BUILD_MODE === 'gateway';

/**
 * index.html is shared by both builds -- its <title>/description/og:*
 * tags are the public, open-source Panda project's own branding, which
 * must stay exactly as-is for the GitHub Pages demo build (deploy.yml).
 * Only the gateway build's HTML (the one actually served behind
 * JusticeOS's login) gets its visible title/install metadata rewritten
 * here, at build time, so there is no runtime flash of the wrong title
 * and no risk of the public demo site ever showing "JusticeOS".
 *
 * Exported (not just used inline below) so a test can call it directly
 * against the real index.html source and assert on the result, without
 * needing a full `vite build` -- see gateway/tests/gatewayHtmlBranding.test.ts.
 *
 * Each replacement is asserted to actually match something in the
 * source HTML -- if index.html's markup ever changes shape, this
 * throws and fails the build loudly instead of silently becoming a
 * no-op and shipping the old Panda-branded title.
 */
export function applyJusticeOsHtmlBranding(html: string): string {
  const replacements: Array<[string, string]> = [
    ['<title>Panda — ACP Client</title>', '<title>JusticeOS</title>'],
    [
      '    <meta\n      name="description"\n      content="A ready-made client for agent developers: your agent speaks ACP, Panda is its UI. Streaming conversations, tool-call cards, inline permissions and polished diffs — no accounts, no telemetry, no backend."\n    />',
      '    <meta\n      name="description"\n      content="JusticeOS: sign in to reach your Insurance Audit Agent — streaming conversations, tool-call cards, inline permissions and polished diffs."\n    />\n    <meta name="application-name" content="JusticeOS" />\n    <meta name="apple-mobile-web-app-title" content="JusticeOS" />',
    ],
    ['<meta property="og:url" content="https://lukaisluka.github.io/Panda/" />\n    ', ''],
    [
      '<meta property="og:title" content="Panda — a ready-made UI for your ACP agent" />',
      '<meta property="og:title" content="JusticeOS" />',
    ],
    [
      '    <meta\n      property="og:description"\n      content="Build the agent, skip the frontend: speak ACP and Panda is your chat UI — streaming replies, tool-call cards, inline permissions and polished diffs."\n    />',
      '    <meta\n      property="og:description"\n      content="Sign in to reach your Insurance Audit Agent."\n    />',
    ],
    ['<meta property="og:image" content="https://lukaisluka.github.io/Panda/og-image.png" />\n    ', ''],
  ];

  let result = html;
  for (const [before, after] of replacements) {
    if (!result.includes(before)) {
      throw new Error(
        `applyJusticeOsHtmlBranding: expected index.html to contain ${JSON.stringify(before)} -- index.html's markup changed shape, update this function.`,
      );
    }
    result = result.replace(before, after);
  }
  return result;
}

function justiceOsHtmlBranding(): Plugin {
  return {
    name: 'justiceos-gateway-html-branding',
    transformIndexHtml(html) {
      return isGatewayBuild ? applyJusticeOsHtmlBranding(html) : html;
    },
  };
}

export default defineConfig({
  plugins: [react(), justiceOsHtmlBranding()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __GATEWAY_BUILD__: JSON.stringify(isGatewayBuild),
  },
  server: {
    // The Tauri shell's devUrl pins 5173; a busy port must fail loudly
    // instead of drifting to 5174 where the shell would load a stale build.
    strictPort: true,
    // Bind IPv4 explicitly: on macOS Node resolves `localhost` to ::1, and
    // WKWebView's localhost lookup goes IPv4 — an IPv6-only listener leaves
    // the shell window blank. 127.0.0.1 keeps shell and browser on one host.
    host: '127.0.0.1',
    // Proxies the gateway's own routes through Vite's dev server so a
    // locally-run frontend talks to the gateway same-origin, exactly
    // like production -- the browser only ever sees 127.0.0.1:5173.
    // Without this, the gateway's SameSite=Strict session cookie and
    // its exact-Origin WebSocket check would both need a second,
    // dev-only allowance instead of just working. Run the gateway
    // itself (`pnpm --filter panda-gateway dev`) on JUSTICEOS_GATEWAY_DEV_PORT
    // (default 4600) alongside this.
    proxy: {
      '/acp': {
        target: `http://127.0.0.1:${process.env.JUSTICEOS_GATEWAY_DEV_PORT || 4600}`,
        ws: true,
      },
    },
  },
});
