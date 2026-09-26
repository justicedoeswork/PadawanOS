import { describe, expect, it } from 'vitest';
import { classifyManagerQuestion } from './managerCommunications';

describe('classifyManagerQuestion', () => {
  it('routes core operational questions deterministically', () => {
    expect(classifyManagerQuestion('What do I need to handle today?')).toEqual({ kind: 'ledger', view: 'today' });
    expect(classifyManagerQuestion('Show me urgent items')).toEqual({ kind: 'ledger', view: 'urgent' });
    expect(classifyManagerQuestion('What is overdue?')).toEqual({ kind: 'ledger', view: 'overdue' });
    expect(classifyManagerQuestion('Who am I waiting on?')).toEqual({ kind: 'ledger', view: 'waiting' });
    expect(classifyManagerQuestion('What did I promise?')).toEqual({ kind: 'ledger', view: 'promises' });
    expect(classifyManagerQuestion('Which emails need replies?')).toEqual({ kind: 'emails' });
    expect(classifyManagerQuestion('What needs my approval?')).toEqual({ kind: 'approvals' });
  });

  it('routes related-entity searches', () => {
    expect(classifyManagerQuestion("What's going on with Ryan?")).toEqual({ kind: 'search', phrase: 'Ryan' });
    expect(classifyManagerQuestion('Show me everything related to Otis St')).toEqual({ kind: 'search', phrase: 'Otis St' });
  });

  it('falls back to help for unsupported questions rather than inventing an answer', () => {
    expect(classifyManagerQuestion('Tell me a joke')).toEqual({ kind: 'help' });
  });
});
