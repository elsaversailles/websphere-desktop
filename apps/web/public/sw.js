self.addEventListener('push', (event) => {
  let payload = { title: 'WebSphere', body: 'You have a new notification.', url: '/' };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* A malformed push should still show a safe notification. */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    badge: '/favicon.ico',
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => client.url === target || client.url.startsWith(self.location.origin));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});
