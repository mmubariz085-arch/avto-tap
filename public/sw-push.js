self.addEventListener('push', function (event) {
  let payload = {
    title: 'AvtoTap',
    body: 'Yeni bildiriş var',
    url: '/',
    tag: 'avtotap-alert',
  };

  try {
    if (event.data) {
      const parsed = event.data.json();
      payload = Object.assign(payload, parsed);
    }
  } catch (e) {
    try {
      if (event.data) {
        payload.body = event.data.text();
      }
    } catch (_err) {
      // ignore
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [300, 100, 300, 100, 350],
      tag: payload.tag || 'avtotap-alert',
      renotify: true,
      requireInteraction: true,
      data: { url: payload.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
