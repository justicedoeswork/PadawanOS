import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The new JusticeOS dashboard UI (AgentRail, Dashboard, ManagerChat,
 * JusticeOsShell, GatewayConnectingState) is gateway-build-only source.
 * Scans source text directly (same technique as
 * noJusticeExteriorsBrandingInFrontend.test.ts / noSecretsInFrontend.test.ts)
 * for the strings that can NEVER legitimately appear here even in a code
 * comment -- Justice Exteriors and Star-Wars-adjacent branding.
 *
 * Deliberately NOT scanned this way: "Panda", "Add agent", "Watch a
 * demo"/"Connect your agent" -- this file's own doc comments legitimately
 * quote those exact phrases to explain what each component replaces/
 * omits (e.g. "no Add agent control" in AgentRail.tsx), which would make
 * a blanket source scan self-defeating. Those are covered instead at the
 * RENDERED-MARKUP layer (AgentRail.test.tsx, JusticeOsShell.test.tsx,
 * GatewayConnectingState.test.tsx, ManagerChat.test.tsx), which checks
 * actual visible output rather than source text.
 */
const REPO_ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const GATEWAY_ONLY_DASHBOARD_FILES = [
  'src/gateway/AgentRail.tsx',
  'src/gateway/Dashboard.tsx',
  'src/gateway/ManagerChat.tsx',
  'src/gateway/JusticeOsShell.tsx',
  'src/gateway/GatewayConnectingState.tsx',
].map((relative) => path.join(REPO_ROOT, relative));

const JUSTICE_EXTERIORS_PATTERN = /justice[-\s]?exteriors/i;
const STAR_WARS_PATTERN = /\b(padawan|yoda|jedi|star\s*wars|lightsaber|sith)\b/i;

describe('JusticeOS dashboard UI source (gateway-build-only files)', () => {
  it('exist -- sanity check the file list above matches what this branch actually added', () => {
    for (const file of GATEWAY_ONLY_DASHBOARD_FILES) {
      expect(fs.existsSync(file), `expected ${path.relative(REPO_ROOT, file)} to exist`).toBe(true);
    }
  });

  it('never names Justice Exteriors -- JusticeOS is a standalone brand', () => {
    const offenders = GATEWAY_ONLY_DASHBOARD_FILES.filter((file) => JUSTICE_EXTERIORS_PATTERN.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('never uses Star Wars / Padawan / Jedi / Yoda branding', () => {
    const offenders = GATEWAY_ONLY_DASHBOARD_FILES.filter((file) => STAR_WARS_PATTERN.test(fs.readFileSync(file, 'utf8')));
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it('never claims the manager backend is operational or sends data anywhere (ManagerChat is a placeholder only)', () => {
    const managerChatSource = fs.readFileSync(path.join(REPO_ROOT, 'src/gateway/ManagerChat.tsx'), 'utf8');
    expect(managerChatSource).not.toMatch(/fetch\s*\(|WebSocket\s*\(|axios/);
  });

  it('the dashboard never hardcodes a fabricated count/business figure for Work queue or Upcoming', () => {
    const dashboardSource = fs.readFileSync(path.join(REPO_ROOT, 'src/gateway/Dashboard.tsx'), 'utf8');
    // Work queue and Upcoming have no backing data source in this
    // frontend yet -- both cards must always be passed a literal empty
    // items array, never a hardcoded number or fabricated list.
    const emptyArrayCount = (dashboardSource.match(/items=\{\[\]\}/g) ?? []).length;
    expect(emptyArrayCount).toBeGreaterThanOrEqual(2);
  });
});
