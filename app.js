import { firebaseConfig, vapidKey } from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";


/* =========================================================
   FIREBASE
========================================================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const messaging = getMessaging(app);


/* =========================================================
   CLOUDINARY
========================================================= */

const CLOUDINARY_CLOUD_NAME = "dao40wei8";

const CLOUDINARY_UPLOAD_PRESET =
  "blaze_panels_upload";


/* =========================================================
   HELPERS
========================================================= */

const $ = (id) =>
  document.getElementById(id);

let editId = null;


function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[m])
  );
}


/* =========================================================
   NETLIFY REAL PUSH NOTIFICATION
========================================================= */

async function sendServerPush({
  type,
  userId = "",
  title,
  message,
  url = "/"
}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Admin login required."
    );
  }

  const idToken =
    await user.getIdToken(true);

  const response = await fetch(
    "/.netlify/functions/send-notification",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${idToken}`
      },

      body: JSON.stringify({
        type,
        userId,
        title,
        message,
        url
      })
    }
  );

  const result =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error ||
      "Push notification failed."
    );
  }

  return result;
}


/* =========================================================
   CLOUDINARY UPLOAD
========================================================= */

async function uploadToCloudinary(
  file,
  folder = "blaze-panels"
) {
  if (!file) return "";

  const endpoint =
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );

  formData.append(
    "upload_preset",
    CLOUDINARY_UPLOAD_PRESET
  );

  formData.append(
    "folder",
    folder
  );

  const response =
    await fetch(endpoint, {
      method: "POST",
      body: formData
    });

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.secure_url
  ) {
    console.error(
      "Cloudinary error:",
      data
    );

    throw new Error(
      data.error?.message ||
      "Cloudinary upload failed."
    );
  }

  return data.secure_url;
}


/* =========================================================
   CURRENT USER
========================================================= */

async function currentUser() {
  return new Promise((resolve) => {

    const unsubscribe =
      onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user);
        }
      );

  });
}


/* =========================================================
   ENSURE USER
========================================================= */

async function ensureUser(user) {

  if (!user) return;

  const userRef =
    doc(
      db,
      "users",
      user.uid
    );

  const snapshot =
    await getDoc(userRef);

  if (!snapshot.exists()) {

    await setDoc(
      userRef,
      {
        name:
          user.displayName || "",

        email:
          user.email || "",

        role:
          "customer",

        createdAt:
          serverTimestamp()
      }
    );

  }
}


/* =========================================================
   SAVE FCM TOKEN
========================================================= */

async function saveToken(user) {

  try {

    if (!user) return;

    if (!("Notification" in window)) {

      console.log(
        "Notifications are not supported."
      );

      return;
    }


    if (
      Notification.permission ===
      "default"
    ) {

      const permission =
        await Notification.requestPermission();

      if (
        permission !== "granted"
      ) {

        console.log(
          "Notification permission denied."
        );

        return;
      }
    }


    if (
      Notification.permission !==
      "granted"
    ) {

      console.log(
        "Notification permission not granted."
      );

      return;
    }


    const registration =
      await navigator
        .serviceWorker
        .register(
          "/firebase-messaging-sw.js"
        );


    const token =
      await getToken(
        messaging,
        {
          vapidKey,

          serviceWorkerRegistration:
            registration
        }
      );


    if (!token) {

      console.log(
        "FCM token not generated."
      );

      return;
    }


    await setDoc(
      doc(
        db,
        "deviceTokens",
        token
      ),
      {
        userId:
          user.uid,

        token,

        email:
          user.email || "",

        updatedAt:
          serverTimestamp(),

        createdAt:
          serverTimestamp()
      },
      {
        merge: true
      }
    );


    console.log(
      "FCM token saved."
    );

  } catch (error) {

    console.error(
      "FCM setup error:",
      error
    );

  }
}


/* =========================================================
   FOREGROUND PUSH
========================================================= */

onMessage(
  messaging,
  (payload) => {

    console.log(
      "Foreground FCM:",
      payload
    );


    const title =
      payload.notification?.title ||
      payload.data?.title ||
      "Blaze Panels";


    const body =
      payload.notification?.body ||
      payload.data?.body ||
      "You have a new notification.";


    if (
      "Notification" in window &&
      Notification.permission ===
        "granted"
    ) {

      try {

        new Notification(
          title,
          {
            body,

            icon:
              "/assets/icon.svg"
          }
        );

      } catch (error) {

        console.log(
          "Foreground notification error:",
          error
        );

      }
    }


    const user =
      auth.currentUser;


    if (user) {
      notifications(user);
    }

  }
);


/* =========================================================
   LOAD PANELS
========================================================= */

async function panels() {

  if (!$("panels")) return;

  try {

    const snapshot =
      await getDocs(
        collection(
          db,
          "panels"
        )
      );


    $("panels").innerHTML = "";


    if (snapshot.empty) {

      $("panels").innerHTML = `
        <div class="card">
          <h3>No panels available</h3>

          <p class="muted">
            New panels will appear here.
          </p>
        </div>
      `;

      return;
    }


    snapshot.forEach(
      (document) => {

        const p =
          document.data();


        $("panels").innerHTML += `
          <article class="panel">

            <img
              src="${esc(
                p.image ||
                "assets/icon.svg"
              )}"
              alt="${esc(
                p.title ||
                "Panel"
              )}"
            >

            <h3>
              ${esc(
                p.title
              )}
            </h3>

            <p class="muted">
              ${esc(
                p.description ||
                ""
              )}
            </p>

            <div class="price">
              ₹${esc(
                p.price || 0
              )}
            </div>

            <a
              class="btn"
              href="buy.html?id=${document.id}"
            >
              Buy Now
            </a>

          </article>
        `;
      }
    );

  } catch (error) {

    console.error(
      "Loading panels failed:",
      error
    );

  }
}


/* =========================================================
   LOAD ORDERS
========================================================= */

async function orders(user) {

  if (!$("orders")) return;


  if (!user) {

    $("orders").innerHTML = `
      <div class="card">
        Please login to view your orders.
      </div>
    `;

    return;
  }


  try {

    const q =
      query(
        collection(
          db,
          "orders"
        ),

        where(
          "userId",
          "==",
          user.uid
        ),

        orderBy(
          "createdAt",
          "desc"
        )
      );


    const snapshot =
      await getDocs(q);


    $("orders").innerHTML = "";


    if (snapshot.empty) {

      $("orders").innerHTML = `
        <div class="card">

          <h3>
            No orders yet
          </h3>

          <p class="muted">
            Your purchased panels
            will appear here.
          </p>

        </div>
      `;

      return;
    }


    snapshot.forEach(
      (document) => {

        const o =
          document.data();


        let buttons = "";


        if (
          o.status ===
          "approved"
        ) {

          buttons = `
            <div>

              ${
                o.apkUrl
                  ? `
                    <a
                      class="btn"
                      href="${esc(
                        o.apkUrl
                      )}"
                      target="_blank"
                      rel="noopener"
                    >
                      Download APK
                    </a>
                  `
                  : ""
              }


              ${
                o.setupUrl
                  ? `
                    <a
                      class="btn"
                      href="${esc(
                        o.setupUrl
                      )}"
                      target="_blank"
                      rel="noopener"
                    >
                      Setup Video
                    </a>
                  `
                  : ""
              }

            </div>
          `;
        }


        $("orders").innerHTML += `
          <div class="card order">

            <div>

              <b>
                ${esc(
                  o.panelTitle ||
                  "Panel"
                )}
              </b>

              <p class="muted">
                Status:
                ${esc(
                  o.status ||
                  "pending"
                )}
              </p>


              ${
                o.utr
                  ? `
                    <p class="muted">
                      UTR:
                      ${esc(o.utr)}
                    </p>
                  `
                  : ""
              }

            </div>

            ${buttons}

          </div>
        `;

      }
    );

  } catch (error) {

    console.error(
      "Loading orders failed:",
      error
    );


    $("orders").innerHTML = `
      <div class="card">
        Unable to load orders.
      </div>
    `;

  }
}


/* =========================================================
   NOTIFICATIONS
========================================================= */

async function notifications(user) {

  if (!$("notifications")) return;

  if (!user) return;


  try {

    const q =
      query(
        collection(
          db,
          "notifications"
        ),

        where(
          "userId",
          "==",
          user.uid
        ),

        orderBy(
          "createdAt",
          "desc"
        )
      );


    const snapshot =
      await getDocs(q);


    $("notifications").innerHTML =
      "";


    if (snapshot.empty) {

      $("notifications").innerHTML = `
        <div class="card">
          No notifications yet.
        </div>
      `;

      return;
    }


    $("notifications").innerHTML =
      "<h3>Notifications</h3>";


    let unread = 0;


    snapshot.forEach(
      (document) => {

        const n =
          document.data();


        if (
          n.read !== true
        ) {
          unread++;
        }


        $("notifications").innerHTML += `
          <div class="card">

            <b>
              ${esc(
                n.title ||
                "Notification"
              )}
            </b>

            <p>
              ${esc(
                n.body ||
                ""
              )}
            </p>

          </div>
        `;

      }
    );


    if ($("badge")) {

      if (unread > 0) {

        $("badge").textContent =
          unread > 99
            ? "99+"
            : String(unread);

        $("badge").style.display =
          "inline-flex";

      } else {

        $("badge").style.display =
          "none";

      }

    }

  } catch (error) {

    console.error(
      "Loading notifications failed:",
      error
    );

  }
}


/* =========================================================
   CHECKOUT
========================================================= */

async function checkout() {

  if (!$("title")) return;


  const id =
    new URLSearchParams(
      location.search
    ).get("id");


  if (!id) return;


  try {

    const snapshot =
      await getDoc(
        doc(
          db,
          "panels",
          id
        )
      );


    if (!snapshot.exists()) {

      $("title").textContent =
        "Panel not found";

      return;
    }


    const panel =
      snapshot.data();


    $("title").textContent =
      panel.title ||
      "Panel";


    $("price").textContent =
      "₹" +
      (panel.price || 0);


    if ($("upi")) {

      $("upi").textContent =
        panel.upi || "";

    }


    window.checkoutPanel = {
      id:
        snapshot.id,

      ...panel
    };


  } catch (error) {

    console.error(
      "Checkout loading failed:",
      error
    );

  }
}


/* =========================================================
   GOOGLE LOGIN
========================================================= */

$("googleLogin")?.addEventListener(
  "click",
  async () => {

    const button =
      $("googleLogin");

    const msg =
      $("msg");


    try {

      button.disabled = true;

      button.textContent =
        "Connecting...";


      if (msg) {
        msg.textContent = "";
      }


      const provider =
        new GoogleAuthProvider();


      provider.setCustomParameters({
        prompt:
          "select_account"
      });


      const result =
        await signInWithPopup(
          auth,
          provider
        );


      const user =
        result.user;


      await ensureUser(user);

      await saveToken(user);


      location.href =
        "index.html";


    } catch (error) {

      console.error(
        "Google login failed:",
        error
      );


      if (msg) {

        if (
          error.code ===
          "auth/popup-closed-by-user"
        ) {

          msg.textContent =
            "Google login cancelled.";

        } else if (
          error.code ===
          "auth/popup-blocked"
        ) {

          msg.textContent =
            "Popup was blocked. Please allow popups and try again.";

        } else {

          msg.textContent =
            error.message ||
            "Google login failed.";

        }

      }


      button.disabled = false;

      button.textContent =
        "Continue with Google";

    }

  }
);


/* =========================================================
   GOOGLE REGISTER
========================================================= */

$("googleRegister")?.addEventListener(
  "click",
  async () => {

    const button =
      $("googleRegister");

    const msg =
      $("msg");


    try {

      button.disabled = true;

      button.textContent =
        "Connecting...";


      if (msg) {
        msg.textContent = "";
      }


      const provider =
        new GoogleAuthProvider();


      provider.setCustomParameters({
        prompt:
          "select_account"
      });


      const result =
        await signInWithPopupimport { firebaseConfig, vapidKey } from "./firebase-config.js";

import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";


/* =========================================================
   FIREBASE
========================================================= */

const app = initializeApp(firebaseConfig);

const auth = getAuth(app);

const db = getFirestore(app);

const messaging = getMessaging(app);


/* =========================================================
   CLOUDINARY
========================================================= */

const CLOUDINARY_CLOUD_NAME = "dao40wei8";

const CLOUDINARY_UPLOAD_PRESET =
  "blaze_panels_upload";


/* =========================================================
   HELPERS
========================================================= */

const $ = (id) =>
  document.getElementById(id);

let editId = null;


function esc(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[m])
  );
}


/* =========================================================
   NETLIFY REAL PUSH NOTIFICATION
========================================================= */

async function sendServerPush({
  type,
  userId = "",
  title,
  message,
  url = "/"
}) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "Admin login required."
    );
  }

  const idToken =
    await user.getIdToken(true);

  const response = await fetch(
    "/.netlify/functions/send-notification",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Authorization":
          `Bearer ${idToken}`
      },

      body: JSON.stringify({
        type,
        userId,
        title,
        message,
        url
      })
    }
  );

  const result =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      result.error ||
      "Push notification failed."
    );
  }

  return result;
}


/* =========================================================
   CLOUDINARY UPLOAD
========================================================= */

async function uploadToCloudinary(
  file,
  folder = "blaze-panels"
) {
  if (!file) return "";

  const endpoint =
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;

  const formData =
    new FormData();

  formData.append(
    "file",
    file
  );

  formData.append(
    "upload_preset",
    CLOUDINARY_UPLOAD_PRESET
  );

  formData.append(
    "folder",
    folder
  );

  const response =
    await fetch(endpoint, {
      method: "POST",
      body: formData
    });

  const data =
    await response.json();

  if (
    !response.ok ||
    !data.secure_url
  ) {
    console.error(
      "Cloudinary error:",
      data
    );

    throw new Error(
      data.error?.message ||
      "Cloudinary upload failed."
    );
  }

  return data.secure_url;
}


/* =========================================================
   CURRENT USER
========================================================= */

async function currentUser() {
  return new Promise((resolve) => {

    const unsubscribe =
      onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          resolve(user);
        }
      );

  });
}


/* =========================================================
   ENSURE USER
========================================================= */

async function ensureUser(user) {

  if (!user) return;

  const userRef =
    doc(
      db,
      "users",
      user.uid
    );

  const snapshot =
    await getDoc(userRef);

  if (!snapshot.exists()) {

    await setDoc(
      userRef,
      {
        name:
          user.displayName || "",

        email:
          user.email || "",

        role:
          "customer",

        createdAt:
          serverTimestamp()
      }
    );

  }
}


/* =========================================================
   SAVE FCM TOKEN
========================================================= */

async function saveToken(user) {

  try {

    if (!user) return;

    if (!("Notification" in window)) {

      console.log(
        "Notifications are not supported."
      );

      return;
    }


    if (
      Notification.permission ===
      "default"
    ) {

      const permission =
        await Notification.requestPermission();

      if (
        permission !== "granted"
      ) {

        console.log(
          "Notification permission denied."
        );

        return;
      }
    }


    if (
      Notification.permission !==
      "granted"
    ) {

      console.log(
        "Notification permission not granted."
      );

      return;
    }


    const registration =
      await navigator
        .serviceWorker
        .register(
          "/firebase-messaging-sw.js"
        );


    const token =
      await getToken(
        messaging,
        {
          vapidKey,

          serviceWorkerRegistration:
            registration
        }
      );


    if (!token) {

      console.log(
        "FCM token not generated."
      );

      return;
    }


    await setDoc(
      doc(
        db,
        "deviceTokens",
        token
      ),
      {
        userId:
          user.uid,

        token,

        email:
          user.email || "",

        updatedAt:
          serverTimestamp(),

        createdAt:
          serverTimestamp()
      },
      {
        merge: true
      }
    );


    console.log(
      "FCM token saved."
    );

  } catch (error) {

    console.error(
      "FCM setup error:",
      error
    );

  }
}


/* =========================================================
   FOREGROUND PUSH
========================================================= */

onMessage(
  messaging,
  (payload) => {

    console.log(
      "Foreground FCM:",
      payload
    );


    const title =
      payload.notification?.title ||
      payload.data?.title ||
      "Blaze Panels";


    const body =
      payload.notification?.body ||
      payload.data?.body ||
      "You have a new notification.";


    if (
      "Notification" in window &&
      Notification.permission ===
        "granted"
    ) {

      try {

        new Notification(
          title,
          {
            body,

            icon:
              "/assets/icon.svg"
          }
        );

      } catch (error) {

        console.log(
          "Foreground notification error:",
          error
        );

      }
    }


    const user =
      auth.currentUser;


    if (user) {
      notifications(user);
    }

  }
);


/* =========================================================
   LOAD PANELS
========================================================= */

async function panels() {

  if (!$("panels")) return;

  try {

    const snapshot =
      await getDocs(
        collection(
          db,
          "panels"
        )
      );


    $("panels").innerHTML = "";


    if (snapshot.empty) {

      $("panels").innerHTML = `
        <div class="card">
          <h3>No panels available</h3>

          <p class="muted">
            New panels will appear here.
          </p>
        </div>
      `;

      return;
    }


    snapshot.forEach(
      (document) => {

        const p =
          document.data();


        $("panels").innerHTML += `
          <article class="panel">

            <img
              src="${esc(
                p.image ||
                "assets/icon.svg"
              )}"
              alt="${esc(
                p.title ||
                "Panel"
              )}"
            >

            <h3>
              ${esc(
                p.title
              )}
            </h3>

            <p class="muted">
              ${esc(
                p.description ||
                ""
              )}
            </p>

            <div class="price">
              ₹${esc(
                p.price || 0
              )}
            </div>

            <a
              class="btn"
              href="buy.html?id=${document.id}"
            >
              Buy Now
            </a>

          </article>
        `;
      }
    );

  } catch (error) {

    console.error(
      "Loading panels failed:",
      error
    );

  }
}


/* =========================================================
   LOAD ORDERS
========================================================= */

async function orders(user) {

  if (!$("orders")) return;


  if (!user) {

    $("orders").innerHTML = `
      <div class="card">
        Please login to view your orders.
      </div>
    `;

    return;
  }


  try {

    const q =
      query(
        collection(
          db,
          "orders"
        ),

        where(
          "userId",
          "==",
          user.uid
        ),

        orderBy(
          "createdAt",
          "desc"
        )
      );


    const snapshot =
      await getDocs(q);


    $("orders").innerHTML = "";


    if (snapshot.empty) {

      $("orders").innerHTML = `
        <div class="card">

          <h3>
            No orders yet
          </h3>

          <p class="muted">
            Your purchased panels
            will appear here.
          </p>

        </div>
      `;

      return;
    }


    snapshot.forEach(
      (document) => {

        const o =
          document.data();


        let buttons = "";


        if (
          o.status ===
          "approved"
        ) {

          buttons = `
            <div>

              ${
                o.apkUrl
                  ? `
                    <a
                      class="btn"
                      href="${esc(
                        o.apkUrl
                      )}"
                      target="_blank"
                      rel="noopener"
                    >
                      Download APK
                    </a>
                  `
                  : ""
              }


              ${
                o.setupUrl
                  ? `
                    <a
                      class="btn"
                      href="${esc(
                        o.setupUrl
                      )}"
                      target="_blank"
                      rel="noopener"
                    >
                      Setup Video
                    </a>
                  `
                  : ""
              }

            </div>
          `;
        }


        $("orders").innerHTML += `
          <div class="card order">

            <div>

              <b>
                ${esc(
                  o.panelTitle ||
                  "Panel"
                )}
              </b>

              <p class="muted">
                Status:
                ${esc(
                  o.status ||
                  "pending"
                )}
              </p>


              ${
                o.utr
                  ? `
                    <p class="muted">
                      UTR:
                      ${esc(o.utr)}
                    </p>
                  `
                  : ""
              }

            </div>

            ${buttons}

          </div>
        `;

      }
    );

  } catch (error) {

    console.error(
      "Loading orders failed:",
      error
    );


    $("orders").innerHTML = `
      <div class="card">
        Unable to load orders.
      </div>
    `;

  }
}


/* =========================================================
   NOTIFICATIONS
========================================================= */

async function notifications(user) {

  if (!$("notifications")) return;

  if (!user) return;


  try {

    const q =
      query(
        collection(
          db,
          "notifications"
        ),

        where(
          "userId",
          "==",
          user.uid
        ),

        orderBy(
          "createdAt",
          "desc"
        )
      );


    const snapshot =
      await getDocs(q);


    $("notifications").innerHTML =
      "";


    if (snapshot.empty) {

      $("notifications").innerHTML = `
        <div class="card">
          No notifications yet.
        </div>
      `;

      return;
    }


    $("notifications").innerHTML =
      "<h3>Notifications</h3>";


    let unread = 0;


    snapshot.forEach(
      (document) => {

        const n =
          document.data();


        if (
          n.read !== true
        ) {
          unread++;
        }


        $("notifications").innerHTML += `
          <div class="card">

            <b>
              ${esc(
                n.title ||
                "Notification"
              )}
            </b>

            <p>
              ${esc(
                n.body ||
                ""
              )}
            </p>

          </div>
        `;

      }
    );


    if ($("badge")) {

      if (unread > 0) {

        $("badge").textContent =
          unread > 99
            ? "99+"
            : String(unread);

        $("badge").style.display =
          "inline-flex";

      } else {

        $("badge").style.display =
          "none";

      }

    }

  } catch (error) {

    console.error(
      "Loading notifications failed:",
      error
    );

  }
}


/* =========================================================
   CHECKOUT
========================================================= */

async function checkout() {

  if (!$("title")) return;


  const id =
    new URLSearchParams(
      location.search
    ).get("id");


  if (!id) return;


  try {

    const snapshot =
      await getDoc(
        doc(
          db,
          "panels",
          id
        )
      );


    if (!snapshot.exists()) {

      $("title").textContent =
        "Panel not found";

      return;
    }


    const panel =
      snapshot.data();


    $("title").textContent =
      panel.title ||
      "Panel";


    $("price").textContent =
      "₹" +
      (panel.price || 0);


    if ($("upi")) {

      $("upi").textContent =
        panel.upi || "";

    }


    window.checkoutPanel = {
      id:
        snapshot.id,

      ...panel
    };


  } catch (error) {

    console.error(
      "Checkout loading failed:",
      error
    );

  }
}


/* =========================================================
   GOOGLE LOGIN
========================================================= */

$("googleLogin")?.addEventListener(
  "click",
  async () => {

    const button =
      $("googleLogin");

    const msg =
      $("msg");


    try {

      button.disabled = true;

      button.textContent =
        "Connecting...";


      if (msg) {
        msg.textContent = "";
      }


      const provider =
        new GoogleAuthProvider();


      provider.setCustomParameters({
        prompt:
          "select_account"
      });


      const result =
        await signInWithPopup(
          auth,
          provider
        );


      const user =
        result.user;


      await ensureUser(user);

      await saveToken(user);


      location.href =
        "index.html";


    } catch (error) {

      console.error(
        "Google login failed:",
        error
      );


      if (msg) {

        if (
          error.code ===
          "auth/popup-closed-by-user"
        ) {

          msg.textContent =
            "Google login cancelled.";

        } else if (
          error.code ===
          "auth/popup-blocked"
        ) {

          msg.textContent =
            "Popup was blocked. Please allow popups and try again.";

        } else {

          msg.textContent =
            error.message ||
            "Google login failed.";

        }

      }


      button.disabled = false;

      button.textContent =
        "Continue with Google";

    }

  }
);


/* =========================================================
   GOOGLE REGISTER
========================================================= */

$("googleRegister")?.addEventListener(
  "click",
  async () => {

    const button =
      $("googleRegister");

    const msg =
      $("msg");


    try {

      button.disabled = true;

      button.textContent =
        "Connecting...";


      if (msg) {
        msg.textContent = "";
      }


      const provider =
        new GoogleAuthProvider();


      provider.setCustomParameters({
        prompt:
          "select_account"
      });


      const result =
        await signInWithPopup
/* =========================================================
   ADMIN - SAVE PANEL
========================================================= */

$("save")?.addEventListener(
  "click",
  async () => {
    try {
      let image =
        $("pimage")?.value.trim() || "";

      let previewVideo =
        $("ppreview")?.value.trim() || "";

      let setupUrl =
        $("psetup")?.value.trim() || "";

      const apkUrl =
        $("papk")?.value.trim() || "";

      const imageFile =
        $("pimageFile")?.files?.[0];

      const previewFile =
        $("ppreviewFile")?.files?.[0];

      const setupFile =
        $("psetupFile")?.files?.[0];


      /* Panel image upload */

      if (imageFile) {
        image =
          await uploadToCloudinary(
            imageFile,
            "blaze-panels/panel-images"
          );
      }


      /* Preview video upload */

      if (previewFile) {
        previewVideo =
          await uploadToCloudinary(
            previewFile,
            "blaze-panels/preview-videos"
          );
      }


      /* Setup video upload */

      if (setupFile) {
        setupUrl =
          await uploadToCloudinary(
            setupFile,
            "blaze-panels/setup-videos"
          );
      }


      const panel = {
        title:
          $("ptitle")?.value.trim() || "",

        price:
          Number(
            $("pprice")?.value || 0
          ),

        image,

        previewVideo,

        apkUrl,

        setupUrl,

        description:
          $("pdesc")?.value.trim() || "",

        updatedAt:
          serverTimestamp()
      };


      if (!panel.title) {
        alert(
          "Enter panel title."
        );
        return;
      }


      if (editId) {

        await updateDoc(
          doc(
            db,
            "panels",
            editId
          ),
          panel
        );

      } else {

        await addDoc(
          collection(
            db,
            "panels"
          ),
          {
            ...panel,

            createdAt:
              serverTimestamp()
          }
        );

      }


      editId = null;

      await adminPanels();


      alert(
        "Panel saved successfully."
      );

    } catch (error) {

      console.error(
        "Saving panel failed:",
        error
      );

      alert(
        error.message
      );

    }
  }
);


/* =========================================================
   ADMIN - PANEL LIST
========================================================= */

async function adminPanels() {

  if (!$("panelList")) return;

  try {

    const snapshot =
      await getDocs(
        collection(
          db,
          "panels"
        )
      );


    $("panelList").innerHTML =
      "";


    snapshot.forEach(
      (document) => {

        const panel =
          document.data();


        $("panelList").innerHTML += `
          <div class="card">

            <b>
              ${esc(
                panel.title
              )}
            </b>

            <button
              class="btn"
              onclick="editPanel('${document.id}')"
            >
              Edit
            </button>

            <button
              class="btn ghost"
              onclick="delPanel('${document.id}')"
            >
              Delete
            </button>

          </div>
        `;

      }
    );

  } catch (error) {

    console.error(
      "Admin panels failed:",
      error
    );

  }
}


/* =========================================================
   ADMIN - DELETE PANEL
========================================================= */

window.delPanel = async (id) => {

  try {

    if (
      !confirm(
        "Delete panel?"
      )
    ) {
      return;
    }


    await deleteDoc(
      doc(
        db,
        "panels",
        id
      )
    );


    await adminPanels();

  } catch (error) {

    console.error(
      "Delete panel failed:",
      error
    );

    alert(
      error.message
    );

  }

};


/* =========================================================
   ADMIN - EDIT PANEL
========================================================= */

window.editPanel = async (id) => {

  try {

    const snapshot =
      await getDoc(
        doc(
          db,
          "panels",
          id
        )
      );


    if (!snapshot.exists()) {
      return;
    }


    const panel =
      snapshot.data();


    editId = id;


    const fields = [
      ["ptitle", "title"],
      ["pprice", "price"],
      ["pimage", "image"],
      ["ppreview", "previewVideo"],
      ["papk", "apkUrl"],
      ["psetup", "setupUrl"],
      ["pdesc", "description"]
    ];


    fields.forEach(
      ([elementId, field]) => {

        if ($(elementId)) {

          $(elementId).value =
            panel[field] ?? "";

        }

      }
    );

  } catch (error) {

    console.error(
      "Edit panel failed:",
      error
    );

  }

};


/* =========================================================
   ADMIN - PENDING ORDERS
========================================================= */

async function pending() {

  if (!$("pending")) return;

  try {

    const q =
      query(
        collection(
          db,
          "orders"
        ),

        where(
          "status",
          "==",
          "pending"
        )
      );


    const snapshot =
      await getDocs(q);


    $("pending").innerHTML =
      "";


    if (snapshot.empty) {

      $("pending").innerHTML =
        "<div>No pending orders.</div>";

      return;
    }


    snapshot.forEach(
      (document) => {

        const order =
          document.data();


        $("pending").innerHTML += `
          <div class="card">

            <b>
              ${esc(
                order.panelTitle
              )}
            </b>

            <p>
              ₹${esc(
                order.amount
              )}
              ·
              ${esc(
                order.utr || ""
              )}
            </p>


            ${
              order.proofUrl
                ? `
                  <a
                    href="${esc(
                      order.proofUrl
                    )}"
                    target="_blank"
                    rel="noopener"
                  >
                    View payment proof
                  </a>
                `
                : ""
            }


            <br>


            <button
              class="btn"
              onclick="approve('${document.id}')"
            >
              Approve
            </button>


            <button
              class="btn ghost"
              onclick="reject('${document.id}')"
            >
              Reject
            </button>

          </div>
        `;

      }
    );

  } catch (error) {

    console.error(
      "Pending orders failed:",
      error
    );

  }

}


/* =========================================================
   ADMIN - APPROVE ORDER
   FIRESTORE + REAL NETLIFY PUSH
========================================================= */

window.approve = async (id) => {

  try {

    const orderRef =
      doc(
        db,
        "orders",
        id
      );


    const orderSnapshot =
      await getDoc(
        orderRef
      );


    if (!orderSnapshot.exists()) {
      return;
    }


    const order =
      orderSnapshot.data();


    if (
      order.status !==
      "pending"
    ) {

      alert(
        `This order is already ${order.status}.`
      );

      await pending();

      return;
    }


    const panelSnapshot =
      await getDoc(
        doc(
          db,
          "panels",
          order.panelId
        )
      );


    const panel =
      panelSnapshot.exists()
        ? panelSnapshot.data()
        : {};


    const approvedMessage =
      `${order.panelTitle} is now ready. Open Your Orders to download it and view setup.`;


    /* -----------------------------------------------------
       1. APPROVE ORDER
    ----------------------------------------------------- */

    await updateDoc(
      orderRef,
      {
        status:
          "approved",

        approvedAt:
          serverTimestamp(),

        apkUrl:
          panel.apkUrl || "",

        setupUrl:
          panel.setupUrl || ""
      }
    );


    /* -----------------------------------------------------
       2. CREATE FIRESTORE NOTIFICATION
    ----------------------------------------------------- */

    await addDoc(
      collection(
        db,
        "notifications"
      ),
      {
        userId:
          order.userId,

        type:
          "order_approved",

        title:
          "Payment approved!",

        body:
          approvedMessage,

        orderId:
          id,

        url:
          "/orders.html",

        createdAt:
          serverTimestamp(),

        read:
          false
      }
    );


    /* -----------------------------------------------------
       3. SEND REAL BROWSER PUSH THROUGH NETLIFY
    ----------------------------------------------------- */

    let pushMessage =
      "Order approved successfully.";


    try {

      const pushResult =
        await sendServerPush({
          type:
            "order_approved",

          userId:
            order.userId,

          title:
            "Payment approved!",

          message:
            approvedMessage,

          url:
            "/orders.html"
        });


      console.log(
        "Approval push result:",
        pushResult
      );


      pushMessage =
        `Order approved. Push sent: ${pushResult.sent ?? 0}`;

    } catch (pushError) {

      console.error(
        "Approval push failed:",
        pushError
      );


      /*
       * Important:
       * Order is already approved.
       * Push failure should NOT undo approval.
       */

      pushMessage =
        "Order approved, but push notification could not be sent.";

    }


    await pending();


    alert(
      pushMessage
    );

  } catch (error) {

    console.error(
      "Approve order failed:",
      error
    );

    alert(
      error.message
    );

  }

};


/* =========================================================
   ADMIN - REJECT ORDER
   FIRESTORE + REAL NETLIFY PUSH
========================================================= */

window.reject = async (id) => {

  try {

    const orderRef =
      doc(
        db,
        "orders",
        id
      );


    const snapshot =
      await getDoc(
        orderRef
      );


    if (!snapshot.exists()) {
      return;
    }


    const order =
      snapshot.data();


    if (
      order.status !==
      "pending"
    ) {

      alert(
        `This order is already ${order.status}.`
      );

      await pending();

      return;
    }


    const rejectedMessage =
      `Your payment for ${order.panelTitle} was not approved. Please contact support.`;


    /* -----------------------------------------------------
       1. REJECT ORDER
    ----------------------------------------------------- */

    await updateDoc(
      orderRef,
      {
        status:
          "rejected",

        rejectedAt:
          serverTimestamp()
      }
    );


    /* -----------------------------------------------------
       2. FIRESTORE NOTIFICATION
    ----------------------------------------------------- */

    await addDoc(
      collection(
        db,
        "notifications"
      ),
      {
        userId:
          order.userId,

        type:
          "order_rejected",

        title:
          "Payment needs attention",

        body:
          rejectedMessage,

        orderId:
          id,

        url:
          "/orders.html",

        createdAt:
          serverTimestamp(),

        read:
          false
      }
    );


    /* -----------------------------------------------------
       3. REAL PUSH
    ----------------------------------------------------- */

    let pushMessage =
      "Order rejected successfully.";


    try {

      const pushResult =
        await sendServerPush({
          type:
            "order_rejected",

          userId:
            order.userId,

          title:
            "Payment needs attention",

          message:
            rejectedMessage,

          url:
            "/orders.html"
        });


      console.log(
        "Rejection push result:",
        pushResult
      );


      pushMessage =
        `Order rejected. Push sent: ${pushResult.sent ?? 0}`;

    } catch (pushError) {

      console.error(
        "Rejection push failed:",
        pushError
      );


      pushMessage =
        "Order rejected, but push notification could not be sent.";

    }


    await pending();


    alert(
      pushMessage
    );

  } catch (error) {

    console.error(
      "Reject order failed:",
      error
    );

    alert(
      error.message
    );

  }

};


/* =========================================================
   ADMIN - ANNOUNCEMENT
   SENDS TO ALL REGISTERED FCM DEVICES
========================================================= */

$("announce")?.addEventListener(
  "click",
  async () => {

    try {

      const title =
        $("atitle")
          ?.value
          .trim() || "";


      const body =
        $("abody")
          ?.value
          .trim() || "";


      if (!title || !body) {

        alert(
          "Enter announcement title and message."
        );

        return;
      }


      /* ---------------------------------------------------
         GET CUSTOMER USERS
      --------------------------------------------------- */

      const usersSnapshot =
        await getDocs(
          query(
            collection(
              db,
              "users"
            ),

            where(
              "role",
              "==",
              "customer"
            )
          )
        );


      /* ---------------------------------------------------
         CREATE IN-SITE NOTIFICATIONS
         FOR EACH CUSTOMER
      --------------------------------------------------- */

      for (
        const userDoc
        of usersSnapshot.docs
      ) {

        await addDoc(
          collection(
            db,
            "notifications"
          ),
          {
            userId:
              userDoc.id,

            type:
              "announcement",

            title,

            body,

            url:
              "/index.html",

            createdAt:
              serverTimestamp(),

            read:
              false
          }
        );

      }


      /* ---------------------------------------------------
         CREATE ANNOUNCEMENT RECORD
      --------------------------------------------------- */

      await addDoc(
        collection(
          db,
          "announcements"
        ),
        {
          title,

          body,

          createdAt:
            serverTimestamp()
        }
      );


      /* ---------------------------------------------------
         ONE REAL PUSH BROADCAST
         DO NOT PUT THIS INSIDE THE LOOP
      --------------------------------------------------- */

      let pushMessage =
        `Announcement created for ${usersSnapshot.size} users.`;


      try {

        const pushResult =
          await sendServerPush({
            type:
              "announcement",

            title,

            message:
              body,

            url:
              "/index.html"
          });


        console.log(
          "Announcement push result:",
          pushResult
        );


        pushMessage =
          `Announcement sent. Push delivered to ${pushResult.sent ?? 0} device(s).`;

      } catch (pushError) {

        console.error(
          "Announcement push failed:",
          pushError
        );


        pushMessage =
          `Announcement created for ${usersSnapshot.size} users, but push notification could not be sent.`;

      }


      if ($("amsg")) {

        $("amsg").textContent =
          pushMessage;

      }


    } catch (error) {

      console.error(
        "Announcement failed:",
        error
      );


      if ($("amsg")) {

        $("amsg").textContent =
          error.message;

      }

    }

  }
);


/* =========================================================
   AUTH STATE
========================================================= */

onAuthStateChanged(
  auth,
  async (user) => {

    if (!user) {
      return;
    }


    try {

      await ensureUser(user);

      await saveToken(user);


      if ($("name")) {

        $("name").textContent =
          user.displayName ||
          "Account";

      }


      if ($("email")) {

        $("email").textContent =
          user.email || "";

      }


      await orders(user);

      await notifications(user);


    } catch (error) {

      console.error(
        "User initialization failed:",
        error
      );

    }

  }
);


/* =========================================================
   INITIAL PAGE LOAD
========================================================= */

panels();

checkout();

adminPanels();

pending();
