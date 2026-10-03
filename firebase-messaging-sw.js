importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"
);

importScripts(
  "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js"
);

firebase.initializeApp({
  apiKey: "AIzaSyBEyGSELXPv1cs3EOU8FJFzlfprX47FxA",
  authDomain: "blaze-panels.firebaseapp.com",
  projectId: "blaze-panels",
  storageBucket: "blaze-panels.firebasestorage.app",
  messagingSenderId: "36114960531",
  appId: "1:36114960531:web:75d5ddbfaff6c6b8007d66"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log(
    "[firebase-messaging-sw.js] Background message:",
    payload
  );

  const data = payload.data || {};

  const title =
    data.title ||
    "Blaze Panels";

  const body =
    data.body ||
    "You have a new notification.";

  const url =
    data.url ||
    "/";

  self.registration.showNotification(title, {
    body,
    icon: "/assets/icon.svg",
    badge: "/assets/icon.svg",
    data: {
      url
    },
    vibrate: [200, 100, 200]
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    event.notification?.data?.url ||
    "/";

  event.waitUntil(
    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    }).then((clientList) => {

      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
