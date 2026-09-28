export type PushNotificationState = 'unsupported' | 'idle' | 'enabled' | 'denied';

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function supported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function getPushNotificationState(): Promise<PushNotificationState> {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const registration = await navigator.serviceWorker.getRegistration('/justiceos-sw.js');
  if (!registration) return 'idle';
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? 'enabled' : 'idle';
}

export async function enablePushNotifications(): Promise<PushNotificationState> {
  if (!supported()) return 'unsupported';

  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'idle';

  const configResponse = await fetch('/api/manager/push/config', {
    credentials: 'same-origin',
    headers: { accept: 'application/json' }
  });
  if (!configResponse.ok) throw new Error('Push configuration is unavailable.');
  const config = (await configResponse.json()) as { enabled?: boolean; publicKey?: string };
  if (!config.enabled || !config.publicKey) throw new Error('Push notifications are not configured.');

  const registration = await navigator.serviceWorker.register('/justiceos-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromBase64Url(config.publicKey)
    });
  }

  const json = subscription.toJSON();
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) throw new Error('Browser push subscription is incomplete.');

  const save = await fetch('/api/manager/push/subscriptions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, p256dh, auth })
  });
  if (!save.ok) throw new Error('Could not save push subscription.');

  return 'enabled';
}
