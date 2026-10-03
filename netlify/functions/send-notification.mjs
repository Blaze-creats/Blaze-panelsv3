import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
    })
  });
}

const db = getFirestore();
const auth = getAuth();
const messaging = getMessaging();

function response(statusCode, data) {
  return new Response(JSON.stringify(data), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function verifyAdmin(request) {
  const header = request.headers.get("authorization") || "";

  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing authorization token.");
  }

  const idToken = header.slice(7);
  const decoded = await auth.verifyIdToken(idToken);

  const adminDoc = await db
    .collection("users")
    .doc(decoded.uid)
    .get();

  if (!adminDoc.exists || adminDoc.data()?.role !== "admin") {
    throw new Error("Admin access required.");
  }

  return decoded;
}

async function getTokensForUser(userId) {
  const snap = await db
    .collection("deviceTokens")
    .where("userId", "==", userId)
    .get();

  return snap.docs
    .map(doc => ({
      id: doc.id,
      token: doc.data()?.token
    }))
    .filter(x => x.token);
}

async function getAllTokens() {
  const snap = await db.collection("deviceTokens").get();

  return snap.docs
    .map(doc => ({
      id: doc.id,
      token: doc.data()?.token
    }))
    .filter(x => x.token);
}

async function sendToTokens(
  tokens,
  title,
  body,
  url,
  extraData = {}
) {
  if (!tokens.length) {
    return {
      sent: 0,
      failed: 0,
      message: "No registered devices found."
    };
  }

  let sent = 0;
  let failed = 0;
  const invalidTokenIds = [];

  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);

    const message = {
      tokens: batch.map(x => x.token),

      data: {
        title: String(title || "Blaze Panels"),
        body: String(
          body || "You have a new notification."
        ),
        url: String(url || "/"),

        ...Object.fromEntries(
          Object.entries(extraData).map(
            ([key, value]) => [
              key,
              String(value ?? "")
            ]
          )
        )
      },

      webpush: {
        headers: {
          Urgency: "high"
        }
      }
    };

    const result =
      await messaging.sendEachForMulticast(message);

    sent += result.successCount;
    failed += result.failureCount;

    result.responses.forEach((item, index) => {
      if (!item.success) {
        const code = item.error?.code || "";

        if (
          code.includes(
            "registration-token-not-registered"
          ) ||
          code.includes(
            "invalid-registration-token"
          )
        ) {
          invalidTokenIds.push(batch[index].id);
        }
      }
    });
  }

  if (invalidTokenIds.length) {
    await Promise.all(
      invalidTokenIds.map(id =>
        db
          .collection("deviceTokens")
          .doc(id)
          .delete()
          .catch(() => {})
      )
    );
  }

  return {
    sent,
    failed,
    removedInvalidTokens: invalidTokenIds.length
  };
}

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization",
          "Access-Control-Allow-Methods":
            "POST, OPTIONS"
        }
      });
    }

    if (request.method !== "POST") {
      return response(405, {
        error: "Only POST requests are allowed."
      });
    }

    await verifyAdmin(request);

    const body = await request.json();

    const {
      type,
      userId,
      title,
      message,
      url = "/"
    } = body;

    if (!type) {
      return response(400, {
        error: "Notification type is required."
      });
    }

    // Specific customer notification
    if (
      type === "order_approved" ||
      type === "order_rejected"
    ) {
      if (!userId) {
        return response(400, {
          error: "userId is required."
        });
      }

      const tokens =
        await getTokensForUser(userId);

      const result = await sendToTokens(
        tokens,
        title,
        message,
        url,
        {
          type,
          userId
        }
      );

      return response(200, {
        success: true,
        type,
        ...result
      });
    }

    // Send announcement to all subscribed users
    if (type === "announcement") {
      const tokens = await getAllTokens();

      const result = await sendToTokens(
        tokens,
        title,
        message,
        url,
        {
          type: "announcement"
        }
      );

      return response(200, {
        success: true,
        type,
        ...result
      });
    }

    return response(400, {
      error: "Unknown notification type."
    });

  } catch (error) {
    console.error(
      "Notification function error:",
      error
    );

    return response(500, {
      error:
        error?.message ||
        "Notification server error."
    });
  }
      }
