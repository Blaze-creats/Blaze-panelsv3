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
  console.log("[firebase-messaging-sw.js] Background message:", payload);

  const notification = payload.notification || {};

  self.registration.showNotification(
    notification.title || "Blaze Panels",
    {
      body: notification.body || "You have a new notification.",
      icon: "/assets/icon.svg",
      data: payload.data || {}
    }
  );
});