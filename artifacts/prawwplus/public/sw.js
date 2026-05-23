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
  let vibrate = [150];

  if (data.type === "incoming_call") {
    const caller = data.fromPhone || data.fromExtension || "Unknown";
    title  = data.title  || "📞 Incoming Call";
    body   = data.body   || `${caller} is calling you`;
    tag    = "incoming-call";
    requireInteraction = true;
    vibrate = [300, 150, 300, 150, 300];
    actions = [
      { action: "answer",  title: "✅ Answer"  },
      { action: "decline", title: "❌ Decline" },
    ];
  } else if (data.type === "missed_call") {
    const caller = data.fromPhone || data.fromExtension || "Unknown";
    title = data.title || "📵 Missed Call";
    body  = data.body  || `You missed a call from ${caller}`;
    tag   = "missed-call";
    vibrate = [200, 100, 200];
  } else if (
    data.type === "call_failed_unavailable" ||
    data.type === "call_failed_declined"    ||
    data.type === "call_failed_no_answer"
  ) {
    title = data.title || "Call Ended";
    body  = data.body  || "Your call could not be connected.";
    tag   = "call-failed";
    vibrate = [150, 75, 150];
  } else if (data.type === "voicemail") {
    title = data.title || "📬 New Voicemail";
    body  = data.body  || "You have a new voicemail message";
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
    vibrate,
    data: { url: data.url ?? "/", ...data },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notifData = event.notification.data ?? {};
  const action    = event.action;
  const callUuid  = notifData.callUuid ?? "";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // Find any existing app window we can message and focus
      const existing = clientList.find((c) => c.url && "focus" in c);

      if (existing) {
        // App is already open — post the action and bring window to front
        if (action === "answer") {
          existing.postMessage({ type: "SW_ANSWER_CALL", callUuid });
        } else if (action === "decline") {
          existing.postMessage({ type: "SW_DECLINE_CALL", callUuid });
        } else {
          existing.postMessage({ type: "SW_FOCUS" });
        }
        return existing.focus();
      }

      // App is closed — encode the pending action in the URL so the newly
      // opened window can read it and auto-answer once Verto delivers the call.
      let targetUrl = "/";
      if (action === "answer") {
        const params = new URLSearchParams({ sw_action: "answer" });
        if (callUuid) params.set("sw_callUuid", callUuid);
        targetUrl = "/?" + params.toString();
      } else if (action === "decline") {
        targetUrl = "/?sw_action=decline";
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
