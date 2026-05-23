/* PRaww+ Service Worker — handles push notifications */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch {}

  let title   = data.title  ?? "PRaww+";
  let body    = data.body   ?? "Tap to open PRaww+";
  let tag     = data.tag    ?? "praww-notification";
  let requireInteraction = false;
  let actions = [];
  let icon    = "/favicon.svg";

  if (data.type === "incoming_call") {
    const caller = data.fromPhone || data.fromExtension || "Unknown";
    title  = "Incoming Call";
    body   = `${caller} is calling you`;
    tag    = "incoming-call";
    requireInteraction = true;
    actions = [
      { action: "answer",  title: "Answer"  },
      { action: "decline", title: "Decline" },
    ];
  } else if (data.type === "missed_call") {
    const caller = data.fromPhone || data.fromExtension || "Unknown";
    title = "Missed Call";
    body  = `You missed a call from ${caller}`;
    tag   = "missed-call";
  } else if (data.type === "voicemail") {
    title = "New Voicemail";
    body  = data.body ?? "You have a new voicemail message";
    tag   = "voicemail";
  }

  const options = {
    body,
    icon,
    badge: "/favicon.svg",
    tag,
    renotify: true,
    requireInteraction,
    actions,
    data: { url: data.url ?? "/", ...data },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data ?? {};
  const action    = event.action;

  let targetUrl = notifData.url ?? "/";
  if (action === "answer" || action === "decline") {
    targetUrl = "/";
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && "focus" in client) {
          if (action === "answer") {
            client.postMessage({ type: "SW_ANSWER_CALL", callUuid: notifData.callUuid });
          } else if (action === "decline") {
            client.postMessage({ type: "SW_DECLINE_CALL", callUuid: notifData.callUuid });
          }
          return client.focus();
        }
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
