import type { ManagerIntent } from './managerCommunications';

export interface PersistedManagerTurn {
  id: string;
  role: 'user' | 'manager' | 'system';
  content: string;
  intent: ManagerIntent | null;
  created_at: string;
}

async function request(path: string, init?: RequestInit): Promise<any> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    },
    ...init
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Manager persistence HTTP ${response.status}`);
  return body;
}

export async function openManagerConversation(): Promise<string> {
  const body = await request('/api/manager/conversations/open', { method: 'POST' });
  const id = body?.data?.id;
  if (typeof id !== 'string' || !id) throw new Error('Manager conversation id missing.');
  return id;
}

export async function loadManagerTurns(conversationId: string): Promise<PersistedManagerTurn[]> {
  const body = await request(`/api/manager/conversations/${encodeURIComponent(conversationId)}/turns`);
  return Array.isArray(body?.data) ? body.data : [];
}

export async function appendManagerTurn(
  conversationId: string,
  turn: { role: 'user' | 'manager' | 'system'; content: string; intent?: ManagerIntent | null }
): Promise<void> {
  await request(`/api/manager/conversations/${encodeURIComponent(conversationId)}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      role: turn.role,
      content: turn.content,
      intent: turn.intent ?? null,
      sourceRefs: []
    })
  });
}
