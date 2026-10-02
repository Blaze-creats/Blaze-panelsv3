# Blaze Panels V2

## Included
- Customer email/password authentication
- Customer account + Your Orders
- Panel catalog
- Checkout with UTR + payment screenshot upload
- Admin panel add/edit/delete
- Admin pending orders
- Approve/reject
- Approval creates a notification record for ONLY that customer
- All-user announcement records
- Browser notification permission + FCM token registration scaffold
- Firestore and Storage security rules
- FCM service worker scaffold

## Real Chrome push
A Firestore notification document alone does NOT send a browser push. For real Chrome push, deploy a trusted server-side Firebase Cloud Function that:
1. receives an admin-approved order / announcement event,
2. looks up only the target user's deviceTokens (or all customer tokens for an announcement),
3. sends FCM using Firebase Admin SDK,
4. never exposes the Admin SDK service-account key to the browser.

Set `YOUR_PUBLIC_VAPID_KEY` in app.js from Firebase Console > Project Settings > Cloud Messaging.

## Admin
Create the first account normally, then in Firestore change that user's `users/{uid}.role` to `admin`. Do not expose admin credentials in frontend code.

## HTTPS
FCM browser notifications require HTTPS in production. Deploy using Firebase Hosting or another HTTPS host.

## Payment safety
The site stores UTR and optional screenshot proof. An admin must approve before the order receives APK/setup URLs. Configure Storage/Firestore rules before production use.
