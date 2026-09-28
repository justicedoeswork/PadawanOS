import type { ManagerApiClient } from './managerApiClient.js';
import { logError, logInfo } from './log.js';
import { sendEmptyPushSignal } from './pushTransport.js';

interface PushSubscriptionRow {
  id: string;
  endpoint: string;
}

interface PushEventRow {
  id: string;
  priority: 'important' | 'urgent';
}

function rowsOf<T>(body: unknown): T[] {
  if (!body || typeof body !== 'object') return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data) ? (data as T[]) : [];
}

export class PushDispatcher {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly options: {
      manager: ManagerApiClient;
      userId: string;
      publicKey: string;
      privateKey: string;
      subject: string;
      intervalMs?: number;
      fetchImpl?: typeof fetch;
    }
  ) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = this.options.intervalMs ?? 60_000;
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const subscriptionsResult = await this.options.manager.request(
        'GET',
        `/push/subscriptions?userId=${encodeURIComponent(this.options.userId)}`
      );
      if (subscriptionsResult.kind !== 'response' || subscriptionsResult.status !== 200) return;
      const subscriptions = rowsOf<PushSubscriptionRow>(subscriptionsResult.body);
      if (subscriptions.length === 0) return;

      const claim = await this.options.manager.request('POST', '/events/push/claim', {
        userId: this.options.userId,
        limit: 10
      });
      if (claim.kind !== 'response' || claim.status !== 200) return;
      const events = rowsOf<PushEventRow>(claim.body);

      for (const event of events) {
        let delivered = 0;
        for (const subscription of subscriptions) {
          try {
            const result = await sendEmptyPushSignal({
              endpoint: subscription.endpoint,
              publicKey: this.options.publicKey,
              privateKey: this.options.privateKey,
              subject: this.options.subject,
              ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {})
            });
            if (result.accepted) delivered += 1;
            if (result.expired) {
              await this.options.manager.request('POST', `/push/subscriptions/${encodeURIComponent(subscription.id)}/disable`, {
                userId: this.options.userId
              });
            }
          } catch (error) {
            logError('push delivery failed', {
              eventId: event.id,
              reason: error instanceof Error ? error.name : 'unknown'
            });
          }
        }

        if (delivered > 0) {
          await this.options.manager.request('POST', `/events/${encodeURIComponent(event.id)}/push-complete`, {
            userId: this.options.userId
          });
        } else {
          await this.options.manager.request('POST', `/events/${encodeURIComponent(event.id)}/push-release`, {
            userId: this.options.userId
          });
        }
      }

      if (events.length > 0) {
        logInfo('push dispatch pass', { events: events.length, subscriptions: subscriptions.length });
      }
    } finally {
      this.running = false;
    }
  }
}
