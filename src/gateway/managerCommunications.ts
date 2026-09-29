export type LedgerView = 'today' | 'urgent' | 'overdue' | 'waiting' | 'inbox' | 'promises';

export type ManagerIntent =
  | { kind: 'calls'; today?: boolean; participant?: string; topic?: string; latest?: boolean }
  | { kind: 'call_facts'; subject: string; topic?: string }
  | { kind: 'briefing' }
  | { kind: 'ledger'; view: LedgerView; person?: string }
  | { kind: 'emails' }
  | { kind: 'approvals' }
  | { kind: 'notifications' }
  | { kind: 'calendar'; range: 'today' | 'tomorrow' | 'week' | 'next' }
  | { kind: 'search'; phrase: string }
  | { kind: 'explain' }
  | { kind: 'repeat' }
  | { kind: 'help' };

export interface ManagerContext {
  lastIntent?: ManagerIntent;
  lastReply?: string;
}

export interface ManagerReply {
  text: string;
  intent: ManagerIntent;
}

export interface ManagerSnapshot {
  today: number;
  urgent: number;
  overdue: number;
  waiting: number;
  replies: number;
  approvals: number;
  notifications: number;
  calendarToday: number;
  signature: string;
}

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function classifyManagerQuestion(raw: string, context: ManagerContext = {}): ManagerIntent {
  const q = clean(raw);
  const lower = q.toLowerCase();
  const callQuestion = q.replace(/[?.!]+$/, '');
  let match: RegExpMatchArray | null;
  if (/^(?:(?:summarize|show|list)(?: me)? (?:my |the )?(?:phone )?calls (?:from |for )?today|(?:my )?today'?s calls)$/i.test(callQuestion)) return { kind: 'calls', today: true };
  if ((match=callQuestion.match(/^(?:tell me (?:the )?|what was (?:the )?)last (?:thing i (?:spoke|talked) about with|call with|conversation with) (.{1,160})$/i))) return { kind:'calls', participant:clean(match[1]!), latest:true };
  if ((match=callQuestion.match(/^when did (?:me and|i and) (.{1,160}?) (?:talk|speak|discuss)(?: about)? (.{1,200})$/i))) return { kind:'calls', participant:clean(match[1]!), topic:clean(match[2]!) };
  if ((match=callQuestion.match(/^what colou?r (.{1,100}?) did (.{1,100}?) say (?:he|she|they) wants?(?: .*)?$/i))) return { kind:'call_facts', subject:clean(match[2]!), topic:clean(match[1]!).replace(/shingles/i,'shingle') };
  if ((match=callQuestion.match(/^what did ((?!(?:we|i)\s).{1,100}?) say about (.{1,150})$/i))) return { kind:'call_facts', subject:clean(match[1]!), topic:clean(match[2]!) };


  if (/^(why|why\?|how come|what do you mean|explain that)[?.!]*$/i.test(q)) {
    return context.lastIntent ? { kind: 'explain' } : { kind: 'help' };
  }
  if (/^(show me (those|them)|which ones|who\?|what ones\?|and those\?)[?.!]*$/i.test(q)) {
    return context.lastIntent ? { kind: 'repeat' } : { kind: 'help' };
  }

  const relatedFollowup = q.match(/^(?:what about|how about)\s+(.+?)[?.!]*$/i);
  if (relatedFollowup?.[1]) return { kind: 'search', phrase: clean(relatedFollowup[1]) };

  const conversationMemory = q.match(
    /^(?:did (?:we|i) (?:ever )?(?:talk|speak|discuss) about|have (?:we|i) (?:ever )?(?:(?:talked|spoken) about|discussed(?: about)?)|what did (?:we|i) (?:talk|speak|discuss) about|what did (?:we|i) say about|when did (?:we|i) (?:talk|speak|discuss) about)\s+(.+?)[?.!]*$/i
  );
  if (conversationMemory?.[1]) return { kind: 'search', phrase: clean(conversationMemory[1]) };

  const personConversationMemory = q.match(
    /^(?:what did i (?:talk|speak|discuss) (?:with|to)|did i (?:talk|speak) (?:with|to)|have i (?:talked|spoken) (?:with|to))\s+(.+?)(?:\s+about\s+(.+?))?[?.!]*$/i
  );
  if (personConversationMemory?.[1]) {
    const phrase = clean(personConversationMemory[2] ? `${personConversationMemory[1]} ${personConversationMemory[2]}` : personConversationMemory[1]);
    return { kind: 'search', phrase };
  }

  const related = q.match(/^(?:what(?:'s| is) going on with|show me everything related to|show me everything about|search for|search)\s+(.+?)[?.!]*$/i);
  if (related?.[1]) return { kind: 'search', phrase: clean(related[1]) };

  const waitingOnPerson = q.match(/^(?:what am i waiting on from|what are we waiting on from|what does|what is)\s+(.+?)\s+(?:owe me|supposed to send|supposed to do)[?.!]*$/i);
  if (waitingOnPerson?.[1]) return { kind: 'ledger', view: 'waiting', person: clean(waitingOnPerson[1]) };

  if (/\b(catch me up|brief me|briefing|what do i need to handle|what needs my attention|what should i handle|what should i know|what do i need to know)\b/i.test(lower)) {
    return { kind: 'briefing' };
  }
  if (/\b(which|what).*emails?.*(need|needs).*repl|\bemails? needing repl|\bneeds? repl/i.test(lower)) return { kind: 'emails' };
  if (/\bapproval|awaiting my approval|need my approval/i.test(lower)) return { kind: 'approvals' };
  if (/\bnotification|alerts?\b/i.test(lower)) return { kind: 'notifications' };
  if (/\b(next appointment|next meeting|next event)\b/i.test(lower)) return { kind: 'calendar', range: 'next' };
  if (/\b(calendar|calandar|schedule|appointments?|meetings?)\b/i.test(lower)) {
    if (/\btomorrow\b/i.test(lower)) return { kind: 'calendar', range: 'tomorrow' };
    if (/\bweek\b|\bnext 7 days\b/i.test(lower)) return { kind: 'calendar', range: 'week' };
    return { kind: 'calendar', range: 'today' };
  }
  if (/\burgent\b|\bimmediate\b/.test(lower)) return { kind: 'ledger', view: 'urgent' };
  if (/\boverdue\b|\bpast due\b/.test(lower)) return { kind: 'ledger', view: 'overdue' };
  if (/\bwaiting on\b|\bwhat am i waiting\b|\bwho am i waiting\b/.test(lower)) return { kind: 'ledger', view: 'waiting' };
  if (/\bpromise|\bwhat did i promise|\bwhat have i promised/.test(lower)) return { kind: 'ledger', view: 'promises' };
  if (/\binbox\b|\bunprocessed tasks?\b/.test(lower)) return { kind: 'ledger', view: 'inbox' };
  if (/\btoday\b/.test(lower)) return { kind: 'ledger', view: 'today' };

  return { kind: 'help' };
}

async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
  return `${label}: ${data.length}\n${lines.join('\n')}${data.length > 8 ? `\n+${data.length - 8} more.` : ''}`;
}

async function ledger(view: LedgerView, person?: string): Promise<unknown[]> {
  const params = person ? `?person=${encodeURIComponent(person)}` : '';
  const body = obj(await getJson(`/api/communications/ledger/views/${view}${params}`));
  return arr(body.data);
}

function localDayWindow(offsetDays = 0): { start: string; end: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + offsetDays);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function calendarWindow(range: 'today' | 'tomorrow' | 'week' | 'next'): { start: string; end: string } {
  if (range === 'tomorrow') return localDayWindow(1);
  if (range === 'week' || range === 'next') {
    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  return localDayWindow(0);
}

async function calendarEvents(range: 'today' | 'tomorrow' | 'week' | 'next'): Promise<unknown[]> {
  const { start, end } = calendarWindow(range);
  const body = obj(await getJson(
    `/api/communications/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  ));
  return arr(body.data).filter((event) => obj(event).isCancelled !== true);
}

function summarizeCalendar(data: unknown[], range: 'today' | 'tomorrow' | 'week' | 'next'): string {
  if (data.length === 0) {
    if (range === 'tomorrow') return 'Your Outlook calendar is clear tomorrow.';
    if (range === 'week' || range === 'next') return 'I do not see any upcoming Outlook calendar events in the next 7 days.';
    return 'Your Outlook calendar is clear today.';
  }

  const chosen = range === 'next' ? data.slice(0, 1) : data.slice(0, 10);
  const lines = chosen.map((event, index) => {
    const title = stringField(event, 'subject') ?? '(no title)';
    const startAt = stringField(event, 'startAt');
    const endAt = stringField(event, 'endAt');
    const location = stringField(event, 'location');
    const timing = startAt
      ? new Date(startAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'time unavailable';
    const end = endAt ? new Date(endAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
    return `${index + 1}. ${title} — ${timing}${end ? `–${end}` : ''}${location ? ` · ${location}` : ''}`;
  });

  if (range === 'next') return `Your next calendar event:\n${lines[0]}`;
  const label = range === 'tomorrow' ? 'Tomorrow' : range === 'week' ? 'Next 7 days' : 'Today';
  return `${label} on your Outlook calendar: ${data.length}\n${lines.join('\n')}${data.length > 10 ? `\n+${data.length - 10} more.` : ''}`;
}

export async function getManagerSnapshot(): Promise<ManagerSnapshot> {
  const [today, urgent, overdue, waiting, repliesBody, approvalsBody, notificationsBody, calendarToday] = await Promise.all([
    ledger('today'),
    ledger('urgent'),
    ledger('overdue'),
    ledger('waiting'),
    getJson('/api/communications/emails/needs-reply'),
    getJson('/api/communications/approvals/pending'),
    getJson('/api/communications/notifications'),
    calendarEvents('today').catch(() => [])
  ]);

  const replies = arr(obj(repliesBody).data).length;
  const approvals = obj(obj(approvalsBody).data);
  const approvalCount = arr(approvals.responseDrafts).length + arr(approvals.calendarProposals).length;
  const notifications = arr(obj(notificationsBody).data).length;

  const snapshot = {
    today: today.length,
    urgent: urgent.length,
    overdue: overdue.length,
    waiting: waiting.length,
    replies,
    approvals: approvalCount,
    notifications,
    calendarToday: calendarToday.length,
  };
  return { ...snapshot, signature: JSON.stringify(snapshot) };
}

export function summarizeSnapshot(s: ManagerSnapshot): string {
  const actionable = s.today + s.urgent + s.overdue + s.replies + s.approvals;
  if (actionable === 0 && s.waiting === 0 && s.notifications === 0 && s.calendarToday === 0) {
    return 'You are caught up. I do not see anything requiring attention in Communications right now.';
  }

  const parts = [
    s.urgent ? `${s.urgent} urgent` : null,
    s.overdue ? `${s.overdue} overdue` : null,
    s.today ? `${s.today} due today` : null,
    s.replies ? `${s.replies} email${s.replies === 1 ? '' : 's'} needing a reply` : null,
    s.approvals ? `${s.approvals} pending approval${s.approvals === 1 ? '' : 's'}` : null,
    s.waiting ? `${s.waiting} item${s.waiting === 1 ? '' : 's'} waiting on someone else` : null,
    s.calendarToday ? `${s.calendarToday} calendar event${s.calendarToday === 1 ? '' : 's'} today` : null,
  ].filter(Boolean);

  return `Here’s your current catch-up: ${parts.join(', ')}.` +
    (s.notifications ? ` There are also ${s.notifications} Communications notifications recorded.` : '');
}

function explanationFor(intent: ManagerIntent | undefined, lastReply?: string): string {
  if (!intent) return 'I do not have enough prior context to explain that yet.';
  if (intent.kind === 'calls' || intent.kind === 'call_facts') return 'That answer comes from stored call transcripts and saved proposed notes. Each note keeps its source quotation. Call participants, people mentioned, and reported speakers are different; reported statements are not direct confirmation.';
  if (intent.kind === 'briefing') {
    return 'I build that catch-up from separate Communications queues: due-today items, urgent items, overdue items, emails needing replies, approvals, waiting items, and notifications. A zero in one queue does not mean you are fully caught up.';
  }
  if (intent.kind === 'ledger') {
    return `That answer came from the Communications “${intent.view}” ledger view only. It does not automatically include the reply, approval, or notification queues.`;
  }
  if (intent.kind === 'emails') return 'That answer comes from messages the Communications workflow currently marks as needing a reply.';
  if (intent.kind === 'approvals') return 'That answer comes from response drafts and calendar proposals currently waiting for approval.';
  if (intent.kind === 'notifications') return 'That answer comes from the Communications notification queue.';
  if (intent.kind === 'calendar') return 'That answer comes directly from your read-only Outlook calendar view. Padawan can read those events, but this path cannot create, edit, cancel, or invite anyone.';
  if (intent.kind === 'search') return `That answer was a literal search for “${intent.phrase}” across Communications records.`;
  return lastReply ? `I was referring to my previous answer: ${lastReply}` : 'I do not have enough prior context to explain that yet.';
}

export async function askManager(raw: string, context: ManagerContext = {}): Promise<ManagerReply> {
  const intent = classifyManagerQuestion(raw, context);

  if (intent.kind === 'explain') {
    return { intent, text: explanationFor(context.lastIntent, context.lastReply) };
  }
  if (intent.kind === 'repeat') {
    const previous = context.lastIntent;
    if (!previous || previous.kind === 'help' || previous.kind === 'explain' || previous.kind === 'repeat') {
      return { intent: { kind: 'help' }, text: 'Tell me which queue or person you want me to show.' };
    }
    if (previous.kind === 'calls' || previous.kind === 'call_facts') return { intent:previous, text:await readCallMemory(previous) };
    const replay =
      previous.kind === 'briefing'
        ? 'catch me up'
        : previous.kind === 'emails'
          ? 'which emails need replies'
          : previous.kind === 'approvals'
            ? 'what needs my approval'
            : previous.kind === 'notifications'
              ? 'show notifications'
              : previous.kind === 'calendar'
                ? previous.range === 'tomorrow'
                  ? 'what is on my calendar tomorrow'
                  : previous.range === 'week'
                    ? 'show my calendar for the week'
                    : previous.range === 'next'
                      ? 'what is my next appointment'
                      : 'what is on my calendar today'
              : previous.kind === 'search'
                ? `what's going on with ${previous.phrase}`
                : previous.person
                  ? `what am i waiting on from ${previous.person}`
                  : previous.view === 'urgent'
                    ? 'show urgent items'
                    : previous.view === 'overdue'
                      ? 'what is overdue'
                      : previous.view === 'waiting'
                        ? 'who am i waiting on'
                        : previous.view === 'promises'
                          ? 'what did i promise'
                          : previous.view === 'inbox'
                            ? 'show inbox'
                            : 'what is due today';
    return askManager(replay);
  }
  if (intent.kind === 'briefing') {
    const snapshot = await getManagerSnapshot();
    return { intent, text: summarizeSnapshot(snapshot) };
  }
  if (intent.kind === 'help') {
    return {
      intent,
      text:
        'Ask me to catch you up, what is on your calendar today or tomorrow, your next appointment, urgent or overdue work, who you are waiting on, which emails need replies, what needs approval, notifications, calls from today, the last call with someone, saved call notes, or what is going on with a person, company, or project.'
    };
  }

  if (intent.kind === 'calls' || intent.kind === 'call_facts') return { intent, text:await readCallMemory(intent) };

  if (intent.kind === 'ledger') {
    const data = await ledger(intent.view, intent.person);
    const labels: Record<LedgerView, string> = {
      today: 'Today',
      urgent: 'Urgent',
      overdue: 'Overdue',
      waiting: intent.person ? `Waiting on ${intent.person}` : 'Waiting',
      inbox: 'Inbox',
      promises: 'Your open promises'
    };
    return { intent, text: summarizeActionItems(data, labels[intent.view]) };
  }

  if (intent.kind === 'emails') {
    const data = arr(obj(await getJson('/api/communications/emails/needs-reply')).data);
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
    const data = obj(obj(await getJson('/api/communications/approvals/pending')).data);
    const drafts = arr(data.responseDrafts);
    const calendar = arr(data.calendarProposals);
    return {
      intent,
      text: `Pending approvals: ${drafts.length} response draft${drafts.length === 1 ? '' : 's'} and ${calendar.length} calendar proposal${calendar.length === 1 ? '' : 's'}.`
    };
  }

  if (intent.kind === 'calendar') {
    const data = await calendarEvents(intent.range);
    return { intent, text: summarizeCalendar(data, intent.range) };
  }

  if (intent.kind === 'notifications') {
    const data = arr(obj(await getJson('/api/communications/notifications')).data);
    if (data.length === 0) return { intent, text: 'No Communications notifications are waiting.' };
    const lines = data.slice(0, 8).map((entry, index) => {
      const title = stringField(entry, 'title') ?? stringField(entry, 'kind') ?? 'Notification';
      const message = stringField(entry, 'message');
      return `${index + 1}. ${title}${message ? ` — ${message}` : ''}`;
    });
    return { intent, text: `Notifications: ${data.length}\n${lines.join('\n')}${data.length > 8 ? `\n+${data.length - 8} more.` : ''}` };
  }

  const data = obj(obj(await getJson(`/api/communications/search?q=${encodeURIComponent(intent.phrase)}`)).data);
  const actions = arr(data.actionItems);
  const emails = arr(data.emails);
  const communications = arr(data.communications);
  const responses = arr(data.responseProposals);
  const calendar = arr(data.calendarProposals);
  const turns = arr(data.conversationTurns);
  const communicationCount = communications.length || emails.length;
  const total = actions.length + communicationCount + responses.length + calendar.length + turns.length;
  if (total === 0) return { intent, text: `I found nothing related to “${intent.phrase}”.` };

  const highlights: string[] = [];
  for (const communication of communications.slice(0, 5)) {
    const provider = stringField(communication, 'provider') ?? 'communication';
    const occurredAt = stringField(communication, 'occurredAt');
    const excerpt = stringField(communication, 'matchedExcerpt');
    const subject = stringField(communication, 'subject');
    const senderObject = obj(obj(communication).sender);
    const sender =
      typeof senderObject.displayName === 'string'
        ? senderObject.displayName
        : typeof senderObject.email === 'string'
          ? senderObject.email
          : typeof senderObject.phone === 'string'
            ? senderObject.phone
            : undefined;
    const when = occurredAt ? new Date(occurredAt).toLocaleString() : null;
    const sourceLabel = provider === 'call_transcription' ? 'Call' : provider === 'outlook' ? 'Email' : 'Communication';
    const heading = [sourceLabel, sender, when].filter(Boolean).join(' · ');
    highlights.push(
      `${heading || sourceLabel}: ${excerpt ?? subject ?? 'Matching communication'}`
    );
  }
  for (const item of actions.slice(0, Math.max(0, 5 - highlights.length))) {
    const title = stringField(item, 'title') ?? stringField(item, 'description');
    if (title) highlights.push(`Task: ${title}`);
  }
  if (communications.length === 0) {
    for (const email of emails.slice(0, Math.max(0, 5 - highlights.length))) {
      const subject = stringField(email, 'subject') ?? '(no subject)';
      highlights.push(`Email: ${subject}`);
    }
  }

  return {
    intent,
    text:
      `Related to “${intent.phrase}”: ${communicationCount} communication(s), ${actions.length} action item(s), ${responses.length} response draft(s), ${calendar.length} calendar proposal(s), and ${turns.length} conversation turn(s).` +
      (highlights.length ? `\n${highlights.join('\n')}` : '')
  };
}


function callTime(value: unknown): string {
  if (typeof value !== 'string') return 'Time unavailable';
  // Accept both ISO and PostgreSQL timestamp strings without browser-dependent parsing.
  const normalized=value.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/([+-]\d{2})$/, '$1:00');
  const date=new Date(normalized);
  if (!Number.isFinite(date.getTime())) return 'Time unavailable';
  return new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(date);
}

async function readCallMemory(intent: Extract<ManagerIntent,{kind:'calls'|'call_facts'}>): Promise<string> {
  const params=new URLSearchParams();
  params.set('limit',intent.kind==='calls' && intent.latest ? '1' : '10');
  if(intent.kind==='call_facts') params.set('subject',intent.subject);
  else {
    if(intent.today) params.set('range','today'); // Service applies its business timezone.
    if(intent.participant) params.set('participant',intent.participant);
  }
  if(intent.topic) params.set('topic',intent.topic);
  const path=intent.kind==='call_facts' ? '/api/communications/call-memory/facts' : '/api/communications/call-memory';
  const data=obj(obj(await getJson(`${path}?${params}`)).data);
  const extra=(data.hasMore===true ? '\nMore matching records are available; this answer is partial.' : '')
    +(typeof data.invalidNotes==='number' && data.invalidNotes>0 ? '\nSome earlier or invalid notes were withheld from this answer.' : '');
  if(intent.kind==='call_facts') {
    const rows=arr(data.results);
    if(!rows.length) return 'No saved evidence matched that question. Notes may still be processing, or the wording may differ.'+extra;
    return 'Saved interpretations, newest calls first. Reported statements are not direct confirmation from that person:\n'+rows.map(row=>{
      const r=obj(row),f=obj(r.fact);
      const attribution=f.attribution==='reported' ? `Reported source: ${String(f.attributedTo)}.` : f.attribution==='speaker_label' ? `Transcript speaker label: ${String(f.attributedTo)}.` : 'Speaker identity is unknown.';
      return `- ${callTime(r.occurredAt)}: ${String(f.statement)}\n${attribution} Evidence: “${String(f.quote)}”\nSource call: ${String(r.messageId)}`;
    }).join('\n')+extra;
  }
  const calls=arr(data.calls);
  if(!calls.length) return 'No stored call transcripts match that request.';
  return (intent.latest ? 'Latest call matching participant metadata:' : intent.today ? "Today's calls:" : 'Matching calls:')+'\n'+calls.map((value,index)=>{
    const call=obj(value),memory=obj(arr(call.memories)[0]),extraction=obj(memory.extraction);
    const summary=arr(extraction.summary);
    const parties=arr(call.participants).map(p=>stringField(p,'displayName') ?? stringField(p,'phone') ?? stringField(p,'email') ?? 'unknown').join(', ');
    const hasMemory=arr(call.memories).length>0;
    let details=summary.length ? summary.map(s=>`Proposed note: ${stringField(s,'text') ?? ''}\nEvidence: “${stringField(s,'quote') ?? ''}”`).join('\n') : `Transcript excerpt (${hasMemory ? 'reviewed; no supported summary retained' : 'summary not yet saved'}): “${String(call.excerpt ?? '')}”`;
    if(call.callKind==='automated_greeting') details=`Automated greeting only; no substantive conversation established.\nTranscript: “${String(call.excerpt ?? '')}”`;
    if(typeof call.withheldMemories==='number' && call.withheldMemories>0 && !hasMemory) details+='\nEarlier notes withheld pending evidence review.';
    const unresolved=arr(extraction.unresolved).filter((v):v is string=>typeof v==='string');
    if(unresolved.length) details+='\nUnresolved: '+unresolved.join(' ');
    return `${index+1}. ${callTime(call.occurredAt)} — participants from call metadata: ${parties}\n${details}\nSource call: ${String(call.messageId)}`;
  }).join('\n\n')+(intent.latest?'':extra);
}
