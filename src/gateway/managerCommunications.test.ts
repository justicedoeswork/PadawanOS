import { describe, expect, it } from 'vitest';
import { classifyManagerQuestion } from './managerCommunications';

describe('classifyManagerQuestion', () => {
  it('routes core operational questions deterministically', () => {
    expect(classifyManagerQuestion('What do I need to handle today?')).toEqual({ kind: 'briefing' });
    expect(classifyManagerQuestion('Show me urgent items')).toEqual({ kind: 'ledger', view: 'urgent' });
    expect(classifyManagerQuestion('What is overdue?')).toEqual({ kind: 'ledger', view: 'overdue' });
    expect(classifyManagerQuestion('Who am I waiting on?')).toEqual({ kind: 'ledger', view: 'waiting' });
    expect(classifyManagerQuestion('What did I promise?')).toEqual({ kind: 'ledger', view: 'promises' });
    expect(classifyManagerQuestion('Which emails need replies?')).toEqual({ kind: 'emails' });
    expect(classifyManagerQuestion('What needs my approval?')).toEqual({ kind: 'approvals' });
    expect(classifyManagerQuestion('What is on my calendar today?')).toEqual({ kind: 'calendar', range: 'today' });
    expect(classifyManagerQuestion('What is on my schedule tomorrow?')).toEqual({ kind: 'calendar', range: 'tomorrow' });
    expect(classifyManagerQuestion('What is my next appointment?')).toEqual({ kind: 'calendar', range: 'next' });
  });

  it('routes related-entity searches', () => {
    expect(classifyManagerQuestion("What's going on with Ryan?")).toEqual({ kind: 'search', phrase: 'Ryan' });
    expect(classifyManagerQuestion('Show me everything related to Otis St')).toEqual({ kind: 'search', phrase: 'Otis St' });
  });

  it('uses prior context for conversational follow-ups', () => {
    const prior = { lastIntent: { kind: 'briefing' } as const, lastReply: 'A prior briefing.' };
    expect(classifyManagerQuestion('why?', prior)).toEqual({ kind: 'explain' });
    expect(classifyManagerQuestion('show me those', prior)).toEqual({ kind: 'repeat' });
    expect(classifyManagerQuestion('what about Ryan?', prior)).toEqual({ kind: 'search', phrase: 'Ryan' });
  });

  it('routes explicit catch-up language to the combined briefing', () => {
    expect(classifyManagerQuestion('Catch me up')).toEqual({ kind: 'briefing' });
    expect(classifyManagerQuestion('What needs my attention?')).toEqual({ kind: 'briefing' });
  });

  it('falls back to help for unsupported questions rather than inventing an answer', () => {
    expect(classifyManagerQuestion('Tell me a joke')).toEqual({ kind: 'help' });
  });
});
