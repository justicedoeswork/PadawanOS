self.addEventListener('push', (event) => {
  event.waitUntil(
    self.registration.showNotification('Padawan', {
      body: 'Padawan has an important update.',
      icon: '/favicon.png',
      badge: '/favicon.png',
      tag: 'justiceos-padawan-update',
      renotify: true,
      data: { url: '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow('/');
    })
  );
});
