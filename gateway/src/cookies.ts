/**
 * Minimal hand-rolled cookie parse/serialize -- avoids pulling in a
 * dependency for what both the raw upgrade request (no Express
 * middleware runs on it) and the Express routes need identically: a
 * "name=value; name2=value2" header parsed into a plain object.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};

  const result: Record<string, string> = {};

  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const name = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);

    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }

  return result;
}

export const SESSION_COOKIE_NAME = 'justiceos_session';
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function sessionCookieHeader(token: string, { secure }: { secure: boolean }): string {
  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);

  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAgeSeconds}`
  ].join('; ');
}

export function clearedSessionCookieHeader({ secure }: { secure: boolean }): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Strict',
    'Path=/',
    'Max-Age=0'
  ].join('; ');
}
