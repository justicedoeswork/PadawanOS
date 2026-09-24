import { describe, it, expect } from 'vitest';
import {
  CONTRACT_VERSION_HEADER,
  CONVERSATION_HEADER,
  headersFor,
  idempotencyKeyFor,
  newTaskId,
  PADAWAN_AGENT_ID,
  REQUESTING_AGENT_HEADER,
  RequestDeduper,
  sanitizeId,
  TASK_HEADER
} from '../src/marketing/requestIdentity.js';

describe('identifier hygiene', () => {
  it('accepts an id-shaped string and rejects anything else', () => {
    expect(sanitizeId('conv_123')).toBe('conv_123');
    expect(sanitizeId('  task:9-a.b  ')).toBe('task:9-a.b');
    expect(sanitizeId('')).toBeNull();
    expect(sanitizeId('has spaces')).toBeNull();
    expect(sanitizeId('<script>')).toBeNull();
    expect(sanitizeId('x'.repeat(201))).toBeNull();
    expect(sanitizeId(42)).toBeNull();
  });

  it('mints a distinguishable task id when the caller did not name one', () => {
    const first = newTaskId();
    expect(first).toMatch(/^task_[0-9a-f-]{36}$/);
    expect(first).not.toBe(newTaskId());
  });

  it('carries the conversation, task, requesting agent and expected contract upstream', () => {
    const headers = headersFor({ conversationId: 'conv_1', taskId: 'task_1', requestingAgent: PADAWAN_AGENT_ID, actor: 'austin' }, '1');
    expect(headers[CONVERSATION_HEADER]).toBe('conv_1');
    expect(headers[TASK_HEADER]).toBe('task_1');
    expect(headers[REQUESTING_AGENT_HEADER]).toBe('padawan');
    expect(headers[CONTRACT_VERSION_HEADER]).toBe('1');
  });

  it('omits an absent identifier rather than sending an empty one', () => {
    const headers = headersFor({ conversationId: null, taskId: null, requestingAgent: PADAWAN_AGENT_ID, actor: null }, '1');
    expect(headers[CONVERSATION_HEADER]).toBeUndefined();
    expect(headers[TASK_HEADER]).toBeUndefined();
  });
});

describe('request identity', () => {
  it('is the same for the same operation and parameters, whatever order they were written in', () => {
    expect(idempotencyKeyFor('research', { kind: 'WEBSITE', competitor: 'acme.test' })).toBe(idempotencyKeyFor('research', { competitor: 'acme.test', kind: 'WEBSITE' }));
  });

  it('differs when a parameter differs', () => {
    expect(idempotencyKeyFor('research', { competitor: 'acme.test' })).not.toBe(idempotencyKeyFor('research', { competitor: 'other.test' }));
  });

  it('differs between operations with identical parameters', () => {
    expect(idempotencyKeyFor('research', { kind: 'WEBSITE' })).not.toBe(idempotencyKeyFor('tick', { kind: 'WEBSITE' }));
  });

  it('is deliberately not scoped to the conversation — the same research asked in two threads is one piece of research', () => {
    const key = idempotencyKeyFor('research', { competitor: 'acme.test' });
    expect(key).toBe(idempotencyKeyFor('research', { competitor: 'acme.test' }));
  });

  it('treats an undefined parameter as absent rather than as a distinct value', () => {
    expect(idempotencyKeyFor('research', { kind: 'WEBSITE', trade: undefined })).toBe(idempotencyKeyFor('research', { kind: 'WEBSITE' }));
  });
});

describe('de-duplication', () => {
  it('collapses concurrent identical requests into one piece of work', async () => {
    const deduper = new RequestDeduper(60_000);
    let calls = 0;
    const work = async () => {
      calls += 1;
      return 'done';
    };

    const [first, second] = await Promise.all([deduper.run('key', 'task_1', work), deduper.run('key', 'task_2', work)]);
    expect(calls).toBe(1);
    expect(first.deduped).toBe(false);
    expect(second.deduped).toBe(true);
    expect(second.originalTaskId).toBe('task_1');
  });

  it('replays a completed answer inside the window and asks again after it', async () => {
    let clock = 0;
    const deduper = new RequestDeduper(1_000, () => clock);
    let calls = 0;
    const work = async () => {
      calls += 1;
      return calls;
    };

    await deduper.run('key', 'task_1', work);
    clock = 500;
    const replayed = await deduper.run('key', 'task_2', work);
    expect(calls).toBe(1);
    expect(replayed.deduped).toBe(true);

    clock = 2_000;
    const fresh = await deduper.run('key', 'task_3', work);
    expect(calls).toBe(2);
    expect(fresh.deduped).toBe(false);
  });

  it('does not pin a failure in front of the window', async () => {
    const deduper = new RequestDeduper(60_000);
    let calls = 0;
    const work = async () => {
      calls += 1;
      if (calls === 1) throw new Error('transport blip');
      return 'recovered';
    };

    await expect(deduper.run('key', 'task_1', work)).rejects.toThrow('transport blip');
    const second = await deduper.run('key', 'task_2', work);
    expect(second.value).toBe('recovered');
    expect(second.deduped).toBe(false);
  });

  it('keeps different keys independent', async () => {
    const deduper = new RequestDeduper(60_000);
    let calls = 0;
    const work = async () => {
      calls += 1;
      return calls;
    };
    await deduper.run('a', null, work);
    await deduper.run('b', null, work);
    expect(calls).toBe(2);
  });
});
