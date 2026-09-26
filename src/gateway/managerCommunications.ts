export type ManagerIntent =
  | { kind: 'ledger'; view: 'today' | 'urgent' | 'overdue' | 'waiting' | 'inbox' | 'promises'; person?: string }
  | { kind: 'emails' }
  | { kind: 'approvals' }
  | { kind: 'notifications' }
  | { kind: 'search'; phrase: string }
  | { kind: 'help' };

export interface ManagerReply {
  text: string;
  intent: ManagerIntent;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function classifyManagerQuestion(raw: string): ManagerIntent {
  const q = clean(raw);
  const lower = q.toLowerCase();

  const related = q.match(/^(?:what(?:'s| is) going on with|show me everything related to|show me everything about|search for|search)\s+(.+?)[?.!]*$/i);
  if (related?.[1]) return { kind: 'search', phrase: clean(related[1]) };

  const waitingOnPerson = q.match(/^(?:what am i waiting on from|what are we waiting on from|what does|what is)\s+(.+?)\s+(?:owe me|supposed to send|supposed to do)[?.!]*$/i);
  if (waitingOnPerson?.[1]) return { kind: 'ledger', view: 'waiting', person: clean(waitingOnPerson[1]) };

  if (/\b(which|what).*emails?.*(need|needs).*repl|\bemails? needing repl|\bneeds? repl/i.test(lower)) return { kind: 'emails' };
  if (/\bapproval|awaiting my approval|need my approval/i.test(lower)) return { kind: 'approvals' };
  if (/\bnotification|alerts?\b/i.test(lower)) return { kind: 'notifications' };
  if (/\burgent\b|\bimmediate\b/.test(lower)) return { kind: 'ledger', view: 'urgent' };
  if (/\boverdue\b|\bpast due\b/.test(lower)) return { kind: 'ledger', view: 'overdue' };
  if (/\bwaiting on\b|\bwhat am i waiting\b|\bwho am i waiting\b/.test(lower)) return { kind: 'ledger', view: 'waiting' };
  if (/\bpromise|\bwhat did i promise|\bwhat have i promised/.test(lower)) return { kind: 'ledger', view: 'promises' };
  if (/\binbox\b|\bunprocessed tasks?\b/.test(lower)) return { kind: 'ledger', view: 'inbox' };
  if (/\btoday\b|\bhandle\b|\bneed to do\b|\bneed to handle\b/.test(lower)) return { kind: 'ledger', view: 'today' };

  return { kind: 'help' };
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringField(value: unknown, key: string): string | undefined {
  const record = obj(value);
  return typeof record[key] === 'string' ? (record[key] as string) : undefined;
}

function summarizeActionItems(data: unknown[], label: string): string {
  if (data.length === 0) return `No ${label.toLowerCase()} items right now.`;
  const lines = data.slice(0, 8).map((item, index) => {
    const title = stringField(item, 'title') ?? stringField(item, 'description') ?? 'Untitled item';
    const due = stringField(item, 'dueAt');
    const waitingOn = stringField(item, 'waitingOn');
    const meta = [due ? `due ${new Date(due).toLocaleString()}` : null, waitingOn ? `waiting on ${waitingOn}` : null]
      .filter(Boolean)
      .join(' · ');
    return `${index + 1}. ${title}${meta ? ` — ${meta}` : ''}`;
  });
  const more = data.length > 8 ? `\n+${data.length - 8} more.` : '';
  return `${label}: ${data.length}\n${lines.join('\n')}${more}`;
}

export async function askManager(raw: string): Promise<ManagerReply> {
  const intent = classifyManagerQuestion(raw);

  if (intent.kind === 'help') {
    return {
      intent,
      text:
        'I can currently answer: what do I need to handle today, show urgent or overdue items, who am I waiting on, what did I promise, which emails need replies, what needs approval, show notifications, or what\'s going on with a person/project/company.'
    };
  }

  if (intent.kind === 'ledger') {
    const params = intent.person ? `?person=${encodeURIComponent(intent.person)}` : '';
    const body = obj(await getJson(`/api/communications/ledger/views/${intent.view}${params}`));
    const labels: Record<typeof intent.view, string> = {
      today: 'Today',
      urgent: 'Urgent',
      overdue: 'Overdue',
      waiting: intent.person ? `Waiting on ${intent.person}` : 'Waiting',
      inbox: 'Inbox',
      promises: 'Your open promises'
    };
    return { intent, text: summarizeActionItems(arr(body.data), labels[intent.view]) };
  }

  if (intent.kind === 'emails') {
    const body = obj(await getJson('/api/communications/emails/needs-reply'));
    const data = arr(body.data);
    if (data.length === 0) return { intent, text: 'No emails currently need a reply.' };
    const lines = data.slice(0, 8).map((entry, index) => {
      const message = obj(obj(entry).message);
      const subject = typeof message.subject === 'string' && message.subject.trim() ? message.subject : '(no subject)';
      const sender = typeof message.sender === 'string' ? message.sender : 'unknown sender';
      return `${index + 1}. ${subject} — ${sender}`;
    });
    return { intent, text: `Emails needing reply: ${data.length}\n${lines.join('\n')}${data.length > 8 ? `\n+${data.length - 8} more.` : ''}` };
  }

  if (intent.kind === 'approvals') {
    const body = obj(await getJson('/api/communications/approvals/pending'));
    const data = obj(body.data);
    const drafts = arr(data.responseDrafts);
    const calendar = arr(data.calendarProposals);
    return {
      intent,
      text: `Pending approvals: ${drafts.length} response draft${drafts.length === 1 ? '' : 's'} and ${calendar.length} calendar proposal${calendar.length === 1 ? '' : 's'}.`
    };
  }

  if (intent.kind === 'notifications') {
    const body = obj(await getJson('/api/communications/notifications'));
    const data = arr(body.data);
    if (data.length === 0) return { intent, text: 'No Communications notifications are waiting.' };
    const lines = data.slice(0, 8).map((entry, index) => {
      const title = stringField(entry, 'title') ?? stringField(entry, 'kind') ?? 'Notification';
      const message = stringField(entry, 'message');
      return `${index + 1}. ${title}${message ? ` — ${message}` : ''}`;
    });
    return { intent, text: `Notifications: ${data.length}\n${lines.join('\n')}${data.length > 8 ? `\n+${data.length - 8} more.` : ''}` };
  }

  const body = obj(await getJson(`/api/communications/search?q=${encodeURIComponent(intent.phrase)}`));
  const data = obj(body.data);
  const actions = arr(data.actionItems);
  const emails = arr(data.emails);
  const responses = arr(data.responseProposals);
  const calendar = arr(data.calendarProposals);
  const turns = arr(data.conversationTurns);
  const total = actions.length + emails.length + responses.length + calendar.length + turns.length;
  if (total === 0) return { intent, text: `I found nothing related to “${intent.phrase}”.` };

  const highlights: string[] = [];
  for (const item of actions.slice(0, 4)) {
    const title = stringField(item, 'title') ?? stringField(item, 'description');
    if (title) highlights.push(`Task: ${title}`);
  }
  for (const email of emails.slice(0, 4)) {
    const subject = stringField(email, 'subject') ?? '(no subject)';
    const sender = stringField(email, 'sender');
    highlights.push(`Email: ${subject}${sender ? ` — ${sender}` : ''}`);
  }

  return {
    intent,
    text:
      `Related to “${intent.phrase}”: ${actions.length} action item(s), ${emails.length} email(s), ${responses.length} response draft(s), ${calendar.length} calendar proposal(s), and ${turns.length} conversation turn(s).` +
      (highlights.length ? `\n${highlights.join('\n')}` : '')
  };
}
