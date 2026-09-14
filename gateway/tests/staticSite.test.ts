import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startTestGateway } from './helpers/testGateway.js';

let cleanup: (() => Promise<void>) | null = null;
let tmpDirs: string[] = [];

afterEach(async () => {
  if (cleanup) await cleanup();
  cleanup = null;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

function makeFakeBuiltDist(markerText: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-gateway-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><html><body>${markerText}</body></html>`);
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), `console.log(${JSON.stringify(markerText)});`);
  tmpDirs.push(dir);
  return dir;
}

describe('static site serving (deployment prep: gateway-mode frontend is built and served)', () => {
  it('serves the built index.html at the site root', async () => {
    const distDir = makeFakeBuiltDist('gateway-build-marker');
    const { port, close } = await startTestGateway({ distDir });
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('gateway-build-marker');
  });

  it('serves built static assets (the built JS bundle) directly', async () => {
    const distDir = makeFakeBuiltDist('asset-marker');
    const { port, close } = await startTestGateway({ distDir });
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('asset-marker');
  });

  it('falls back to index.html for an unknown client-side route (SPA fallback)', async () => {
    const distDir = makeFakeBuiltDist('spa-fallback-marker');
    const { port, close } = await startTestGateway({ distDir });
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/some/client/route`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('spa-fallback-marker');
  });

  it('answers a friendly 503 (not a crash, not the SPA) when dist/ has not been built yet', async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-gateway-unbuilt-'));
    tmpDirs.push(emptyDir);
    const { port, close } = await startTestGateway({ distDir: emptyDir });
    cleanup = close;

    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(503);
    expect(await res.text()).toMatch(/not been built yet/i);
  });

  it('never lets the SPA fallback shadow a real API/ACP route', async () => {
    const distDir = makeFakeBuiltDist('should-not-see-this');
    const { port, close } = await startTestGateway({ distDir });
    cleanup = close;

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    expect(await health.text()).not.toContain('should-not-see-this');

    const acpUnknown = await fetch(`http://127.0.0.1:${port}/acp/does-not-exist`);
    expect(acpUnknown.status).toBe(404);
    const acpBody = await acpUnknown.text();
    expect(acpBody).not.toContain('should-not-see-this');
    expect(() => JSON.parse(acpBody)).not.toThrow(); // JSON, never the HTML shell
  });
});
