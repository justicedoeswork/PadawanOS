import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';

/**
 * A minimal stand-in for the Insurance Agent's Phase 1 private ACP
 * listener -- enforces the exact same contract (Authorization: Bearer
 * <key>, x-acp-user-id, x-acp-realm-id, checked before any upgrade is
 * accepted) so the gateway's relay tests exercise a real auth
 * boundary on the upstream side too, not just a bare echo server.
 */
export interface MockAcpAgentOptions {
  expectedServiceKey: string;
  expectedUserId: string;
  expectedRealmId: string;
}

export interface ConnectionRecord {
  headers: IncomingMessage['headers'];
  receivedMessages: string[];
  socket: WebSocket;
}

export interface MockAcpAgent {
  port: number;
  connections: ConnectionRecord[];
  close(): Promise<void>;
}

export function startMockAcpAgent(options: MockAcpAgentOptions): Promise<MockAcpAgent> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  const connections: ConnectionRecord[] = [];

  wss.on('connection', (ws, req) => {
    const authHeader = req.headers['authorization'];
    const userId = req.headers['x-acp-user-id'];
    const realmId = req.headers['x-acp-realm-id'];

    const expectedAuth = `Bearer ${options.expectedServiceKey}`;

    if (authHeader !== expectedAuth || userId !== options.expectedUserId || realmId !== options.expectedRealmId) {
      ws.close(1008, 'policy violation');
      return;
    }

    const record: ConnectionRecord = { headers: req.headers, receivedMessages: [], socket: ws };
    connections.push(record);

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString('utf8');
      record.receivedMessages.push(text);

      // Minimal ACP-shaped response so relay tests have something
      // real to check on the way back down.
      try {
        const parsed = JSON.parse(text) as { id?: number; method?: string };
        if (parsed.method === 'initialize' && parsed.id !== undefined) {
          ws.send(
            JSON.stringify({
              jsonrpc: '2.0',
              id: parsed.id,
              result: { protocolVersion: 1, agentInfo: { name: 'mock-agent' }, agentCapabilities: {}, authMethods: [] }
            })
          );
        }
      } catch {
        // Not JSON -- echoed as-is for frame-preservation tests.
        ws.send(text);
      }
    });
  });

  return new Promise((resolve) => {
    wss.once('listening', () => {
      const address = wss.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      resolve({
        port,
        connections,
        close: () =>
          new Promise((res, rej) => {
            wss.close((err) => (err ? rej(err) : res()));
          })
      });
    });
  });
}
