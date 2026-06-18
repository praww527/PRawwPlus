/* PRaww+ Service Worker — handles push notifications */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(clients.claim());
});

// Allow the main thread to request immediate activation of a waiting SW
// (used by the "New version available — Reload" banner in main.tsx).
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
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

  if (data.type === "incoming_call" || data.type === "incoming_call_wakeup" || data.type === "call_wakeup") {
    const caller = data.callerNumber || data.fromPhone || "Unknown caller";
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
    const caller = data.callerName || data.callerNumber || data.fromPhone || "Unknown caller";
    title = data.title || "📵 Missed Call";
    body  = data.body  || `You missed a call from ${caller}`;
    tag   = "missed-call";
    vibrate = [200, 100, 200];
    actions = [
      { action: "callback", title: "📞 Call Back" },
    ];
  } else if (data.type === "missed_call_digest") {
    const count = data.count || "multiple";
    title = data.title || `📵 ${count} Missed Calls`;
    body  = data.body  || `You have ${count} missed calls`;
    tag   = "missed-call-digest";
    vibrate = [200, 100, 200];
    actions = [
      { action: "open", title: "View Calls" },
    ];
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

  const notifData   = event.notification.data ?? {};
  const action      = event.action;
  const callUuid    = notifData.callUuid  ?? "";
  const callerNumber = notifData.callerNumber ?? notifData.fromPhone ?? "";

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const existing = clientList.find((c) => c.url && "focus" in c);

      if (existing) {
        if (action === "answer") {
          existing.postMessage({ type: "SW_ANSWER_CALL", callUuid });
        } else if (action === "decline") {
          existing.postMessage({ type: "SW_DECLINE_CALL", callUuid });
        } else if (action === "callbook" || action === "callback") {
          // Post the number to the open app — CallContext listens for this and
          // opens the dialler pre-filled with the caller's number.
          existing.postMessage({ type: "SW_CALL_BACK", callerNumber });
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
      } else if (action === "callback") {
        // Open app with the dialler pre-filled
        const params = new URLSearchParams({ sw_action: "callout" });
        if (callerNumber) params.set("sw_number", callerNumber);
        targetUrl = "/?" + params.toString();
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
