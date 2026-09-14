/**
 * The gateway's only logging surface. Deliberately narrow: it takes a
 * plain message and an optional flat record of non-secret metadata --
 * there is no path in this module that accepts a raw request, a
 * cookie header, an Authorization header, or an ACP message body, so
 * a caller cannot accidentally log one even under time pressure. If a
 * future change needs to log something request-shaped, it must first
 * pick out the specific safe fields (e.g. `{ ip, path }`), never pass
 * the object itself.
 *
 * Never call this with: passwords, the session cookie/token, the ACP
 * service key, or ACP message contents. `redactedUrl` exists
 * specifically so a WebSocket target URL can be logged with any
 * embedded credential removed first.
 */
type LogMeta = Record<string, string | number | boolean | null | undefined>;

function format(level: string, message: string, meta?: LogMeta): string {
  const metaSuffix = meta
    ? ' ' + Object.entries(meta)
        .map(([key, value]) => `${key}=${value}`)
        .join(' ')
    : '';

  return `[${new Date().toISOString()}] ${level} panda-gateway: ${message}${metaSuffix}`;
}

export function logInfo(message: string, meta?: LogMeta): void {
  console.log(format('INFO', message, meta));
}

export function logWarn(message: string, meta?: LogMeta): void {
  console.warn(format('WARNING', message, meta));
}

export function logError(message: string, meta?: LogMeta): void {
  console.error(format('ERROR', message, meta));
}

/** Strips userinfo and query string from a URL before it's ever logged -- a ws:// upstream URL never carries a credential in this design, but this is cheap insurance against a future change that puts one there by accident. */
export function redactedUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '(unparseable url)';
  }
}
