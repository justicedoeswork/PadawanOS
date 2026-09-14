import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { verifySessionToken } from './session.js';
import { SESSION_COOKIE_NAME, parseCookies } from './cookies.js';
import { logInfo, logWarn, redactedUrl } from './log.js';

const ACP_PATH = '/acp/insurance';

/** Plenty for chat text; matches the Insurance Agent's own private-listener limit (Phase 1) for a consistent ceiling end to end. */
const MAX_PAYLOAD_BYTES = 256 * 1024;

const PING_INTERVAL_MS = 30_000;

/** A single owner realistically has a handful of tabs/devices open at once, never more. */
const MAX_CONCURRENT_CONNECTIONS = 5;

/** Above this much unsent, buffered data on either socket, the relay gives up on that connection rather than let memory grow unbounded. */
const BACKPRESSURE_LIMIT_BYTES = 1024 * 1024;

export interface AcpProxyOptions {
  sessionSecret: string;
  allowedOrigins: string[];
  insuranceAgentAcpUrl: string;
  acpGatewayServiceKey: string;
  allowedUserId: string;
  allowedRealmId: string;
  maxConnections?: number;
}

export interface AcpProxyHandle {
  /** Number of currently-open browser<->upstream connection pairs. */
  activeConnectionCount(): number;
  /** Closes every open pair -- used for graceful shutdown and test teardown. */
  closeAll(): void;
}

/**
 * RFC 6455 reserves 1004/1005/1006/1015 as receive-only status codes
 * -- they describe how a connection ended but must never actually be
 * put on the wire, and `ws` throws if asked to. When propagating a
 * close from one side of the relay to the other, a received code
 * outside the sendable set is replaced with a generic 1000 rather
 * than crashing the relay.
 */
const SENDABLE_CLOSE_CODES = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014]);

function forwardableCloseCode(code: number): number {
  if (code >= 3000 && code <= 4999) return code;
  if (SENDABLE_CLOSE_CODES.has(code)) return code;
  return 1000;
}

function rejectUpgrade(socket: Duplex, statusLine: string): void {
  try {
    socket.write(`HTTP/1.1 ${statusLine}\r\nConnection: close\r\n\r\n`);
  } catch {
    // Socket may already be gone; nothing more to do.
  }

  socket.destroy();
}

function originIsAllowed(req: IncomingMessage, allowedOrigins: string[]): boolean {
  const origin = req.headers.origin;
  return typeof origin === 'string' && allowedOrigins.includes(origin);
}

/**
 * Relays whatever text frames arrive on `from`, unmodified and one at
 * a time, onto `to` -- never buffered, joined, or split. If `to` is
 * already backed up past the backpressure limit, the relay closes
 * both sides rather than let the queue grow without bound. Only used
 * for the upstream->downstream direction, where `to` (the browser
 * socket) is already open by construction before this ever runs.
 */
function relay(from: WebSocket, to: WebSocket, direction: 'downstream->upstream' | 'upstream->downstream'): void {
  from.on('message', (data, isBinary) => {
    if (isBinary) return; // ACP is text-frame JSON-RPC only.
    if (to.readyState !== WebSocket.OPEN) return;

    if (to.bufferedAmount > BACKPRESSURE_LIMIT_BYTES) {
      logWarn('relay backpressure limit exceeded, closing connection pair', { direction });
      from.close(1011, 'backpressure limit exceeded');
      to.close(1011, 'backpressure limit exceeded');
      return;
    }

    // ws's message event always hands `data` back as a Buffer,
    // regardless of the ORIGINAL frame's type -- .send() infers frame
    // type from the JS type of its argument, so sending a Buffer
    // as-is would silently re-encode every relayed message as a
    // binary frame. { binary: false } is what actually preserves the
    // text frame the sender intended (already confirmed by the
    // isBinary guard above).
    to.send(data, { binary: false });
  });
}

function wireConnectionPair(downstream: WebSocket, upstream: WebSocket, onClosed: () => void): void {
  let isAlive = true;

  downstream.on('pong', () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      downstream.terminate();
      return;
    }

    isAlive = false;
    downstream.ping();
  }, PING_INTERVAL_MS);

  const cleanup = (): void => {
    clearInterval(pingInterval);
    onClosed();
  };

  /*
   * The browser can send a message the instant its own WebSocket is
   * open, which is BEFORE this gateway's own upstream dial to the
   * Insurance Agent has necessarily finished its handshake. A message
   * arriving on `downstream` in that window has nowhere to go yet --
   * buffered here (never combined into one frame, replayed as the
   * same individual sends once `upstream` opens) rather than
   * dropped, which is what happens if this listener is only attached
   * inside `upstream.on('open')`.
   */
  let upstreamReady = false;
  const bufferedFromDownstream: Array<Buffer | string> = [];

  downstream.on('message', (data, isBinary) => {
    if (isBinary) return; // ACP is text-frame JSON-RPC only.

    if (!upstreamReady) {
      bufferedFromDownstream.push(data as Buffer);
      return;
    }

    if (upstream.readyState !== WebSocket.OPEN) return;

    if (upstream.bufferedAmount > BACKPRESSURE_LIMIT_BYTES) {
      logWarn('relay backpressure limit exceeded, closing connection pair', {
        direction: 'downstream->upstream'
      });
      downstream.close(1011, 'backpressure limit exceeded');
      upstream.close(1011, 'backpressure limit exceeded');
      return;
    }

    // See the comment in relay() above: .send() must be told this is
    // a text frame, or the Buffer form ws hands back gets re-encoded
    // as binary -- which the real Insurance Agent's listener silently
    // discards (ACP is text-frame JSON-RPC only).
    upstream.send(data, { binary: false });
  });

  upstream.on('open', () => {
    upstreamReady = true;

    for (const frame of bufferedFromDownstream) {
      if (upstream.readyState !== WebSocket.OPEN) break;
      upstream.send(frame, { binary: false });
    }
    bufferedFromDownstream.length = 0;

    relay(upstream, downstream, 'upstream->downstream');
  });

  upstream.on('error', () => {
    // Never forward the raw upstream error to the browser -- it could
    // describe internal network topology (the private ACP URL, DNS
    // failures, etc). A generic close code is all the client needs.
    if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) {
      downstream.close(1011, 'upstream connection failed');
    }
  });

  downstream.on('close', (code, reason) => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(forwardableCloseCode(code), reason);
    }
    cleanup();
  });

  upstream.on('close', (code, reason) => {
    if (downstream.readyState === WebSocket.OPEN || downstream.readyState === WebSocket.CONNECTING) {
      downstream.close(forwardableCloseCode(code), reason);
    }
    cleanup();
  });

  downstream.on('error', () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
      upstream.close(1011, 'downstream connection error');
    }
  });
}

/**
 * Attaches the /acp/insurance upgrade handler to an existing
 * http.Server. Every field in `options` can be overridden explicitly
 * (tests do this with an ephemeral mock agent + throwaway secrets);
 * the real server.ts call site passes the real config values.
 */
export function attachAcpProxy(httpServer: HttpServer, options: AcpProxyOptions): AcpProxyHandle {
  const maxConnections = options.maxConnections ?? MAX_CONCURRENT_CONNECTIONS;
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
  const activePairs = new Set<WebSocket>();

  httpServer.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];

    if (path !== ACP_PATH) {
      // Not ours -- another upgrade handler (if any) may still claim it.
      return;
    }

    if (!originIsAllowed(req, options.allowedOrigins)) {
      logWarn('acp upgrade rejected: disallowed or missing Origin');
      rejectUpgrade(socket, '403 Forbidden');
      return;
    }

    const cookies = parseCookies(req.headers.cookie);

    if (!verifySessionToken(cookies[SESSION_COOKIE_NAME], options.sessionSecret)) {
      logWarn('acp upgrade rejected: missing or invalid session');
      rejectUpgrade(socket, '401 Unauthorized');
      return;
    }

    if (activePairs.size >= maxConnections) {
      logWarn('acp upgrade rejected: connection limit reached');
      rejectUpgrade(socket, '503 Service Unavailable');
      return;
    }

    wss.handleUpgrade(req, socket, head, (downstream) => {
      wss.emit('connection', downstream);
    });
  });

  wss.on('connection', (downstream) => {
    // Exactly one upstream WebSocket for this one downstream WebSocket
    // -- never looked up, pooled, or shared from an existing set.
    const upstream = new WebSocket(options.insuranceAgentAcpUrl, {
      headers: {
        Authorization: `Bearer ${options.acpGatewayServiceKey}`,
        'x-acp-user-id': options.allowedUserId,
        'x-acp-realm-id': options.allowedRealmId
      },
      maxPayload: MAX_PAYLOAD_BYTES
    });

    activePairs.add(downstream);
    logInfo('acp connection opened', {
      upstream: redactedUrl(options.insuranceAgentAcpUrl),
      activeConnections: activePairs.size
    });

    wireConnectionPair(downstream, upstream, () => {
      activePairs.delete(downstream);
      logInfo('acp connection closed', { activeConnections: activePairs.size });
    });
  });

  return {
    activeConnectionCount: () => activePairs.size,
    closeAll: () => {
      for (const downstream of activePairs) {
        downstream.close(1001, 'server shutting down');
      }
      wss.close();
    }
  };
}
