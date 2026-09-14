import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The settings page displays the release version; inject it from package.json
// at build time so web and desktop (one shared build) can never disagree.
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
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
    // itself (`pnpm --filter panda-gateway dev`) on PANDA_GATEWAY_DEV_PORT
    // (default 4600) alongside this.
    proxy: {
      '/acp': {
        target: `http://127.0.0.1:${process.env.PANDA_GATEWAY_DEV_PORT || 4600}`,
        ws: true,
      },
    },
  },
});
