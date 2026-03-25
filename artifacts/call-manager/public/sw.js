/* PRaww+ Service Worker — handles push notifications */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("push", (event) => {
  let data = { title: "PRaww+", body: "You have a new notification." };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch {}

  const options = {
    body: data.body,
    icon: "/favicon.svg",
    badge: "/favicon.svg",
    tag: data.tag ?? "praww-notification",
    renotify: true,
    requireInteraction: data.requireInteraction ?? false,
    data: { url: data.url ?? "/" },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.focus();
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
