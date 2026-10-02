const {
  onDocumentUpdated,
  onDocumentCreated
} = require("firebase-functions/v2/firestore");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

const MAX_TOKENS_PER_BATCH = 500;


// ===============================
// HELPER: Split array into chunks
// ===============================

function chunk(array, size) {
  const result = [];

  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }

  return result;
}


// ===============================
// GET TOKENS FOR ONE USER
// ===============================

async function getUserTokens(userId) {
  if (!userId) {
    return [];
  }

  const snapshot = await db
    .collection("deviceTokens")
    .where("userId", "==", userId)
    .get();

  return snapshot.docs
    .map((doc) => ({
      docId: doc.id,
      token: doc.data().token
    }))
    .filter((item) => item.token);
}


// ===============================
// GET ALL DEVICE TOKENS
// ===============================

async function getAllTokens() {
  const snapshot = await db
    .collection("deviceTokens")
    .get();

  return snapshot.docs
    .map((doc) => ({
      docId: doc.id,
      token: doc.data().token
    }))
    .filter((item) => item.token);
}


// ===============================
// CHECK INVALID FCM TOKEN
// ===============================

function isInvalidTokenError(code) {
  return (
    code === "messaging/registration-token-not-registered" ||
    code === "messaging/invalid-registration-token"
  );
}


// ===============================
// DELETE INVALID TOKENS
// ===============================

async function removeInvalidTokens(items, response) {
  const deletes = [];

  response.responses.forEach((result, index) => {

    if (result.success) {
      return;
    }

    const errorCode = result.error?.code;

    if (!isInvalidTokenError(errorCode)) {
      return;
    }

    const item = items[index];

    if (item?.docId) {
      deletes.push(
        db
          .collection("deviceTokens")
          .doc(item.docId)
          .delete()
      );
    }
  });

  if (deletes.length > 0) {
    await Promise.all(deletes);
  }
}


// ===============================
// SEND PUSH NOTIFICATION
// ===============================

async function sendToTokens(
  items,
  title,
  body,
  data = {}
) {

  if (!items.length) {
    return;
  }

  const batches = chunk(
    items,
    MAX_TOKENS_PER_BATCH
  );

  for (const batch of batches) {

    const tokens = batch.map(
      (item) => item.token
    );

    const response =
      await messaging.sendEachForMulticast({

        tokens,

        notification: {
          title,
          body
        },

        data: Object.fromEntries(
          Object.entries(data).map(
            ([key, value]) => [
              key,
              String(value)
            ]
          )
        ),

        webpush: {
          fcmOptions: {
            link:
              data.url ||
              "/index.html"
          }
        }
      });

    await removeInvalidTokens(
      batch,
      response
    );
  }
}


// =====================================================
// ORDER STATUS PUSH
// =====================================================
//
// pending → approved
// pending → rejected
//
// Push ONLY goes to that order's customer.
// =====================================================

exports.orderStatusPush =
  onDocumentUpdated(
    "orders/{orderId}",
    async (event) => {

      const before =
        event.data?.before?.data();

      const after =
        event.data?.after?.data();

      if (!before || !after) {
        return;
      }


      const oldStatus =
        before.status;

      const newStatus =
        after.status;


      // Nothing changed
      if (oldStatus === newStatus) {
        return;
      }


      // Only handle approved/rejected
      if (
        newStatus !== "approved" &&
        newStatus !== "rejected"
      ) {
        return;
      }


      const userId =
        after.userId;

      if (!userId) {
        return;
      }


      const panelTitle =
        after.panelTitle ||
        "Your order";


      // ===============================
      // APPROVED
      // ===============================

      if (newStatus === "approved") {

        const tokens =
          await getUserTokens(userId);

        await sendToTokens(
          tokens,

          "Payment approved!",

          `${panelTitle} is ready. Open Your Orders to download it.`,

          {
            url: "/orders.html",
            orderId: event.params.orderId,
            status: "approved"
          }
        );

        return;
      }


      // ===============================
      // REJECTED
      // ===============================

      if (newStatus === "rejected") {

        const tokens =
          await getUserTokens(userId);

        await sendToTokens(
          tokens,

          "Order update",

          `${panelTitle} was rejected. Open Your Orders for details.`,

          {
            url: "/orders.html",
            orderId: event.params.orderId,
            status: "rejected"
          }
        );

        return;
      }
    }
  );


// =====================================================
// ADMIN ANNOUNCEMENT PUSH
// =====================================================
//
// When admin creates:
//
// announcements/{announcementId}
//
// notification goes to ALL subscribed device tokens.
// =====================================================

exports.announcementPush =
  onDocumentCreated(
    "announcements/{announcementId}",
    async (event) => {

      const announcement =
        event.data?.data();

      if (!announcement) {
        return;
      }


      const title =
        announcement.title ||
        "Blaze Panels";


      const body =
        announcement.body ||
        "You have a new announcement.";


      const tokens =
        await getAllTokens();


      await sendToTokens(

        tokens,

        title,

        body,

        {
          url: "/index.html",
          announcementId:
            event.params.announcementId
        }

      );
    }
  );