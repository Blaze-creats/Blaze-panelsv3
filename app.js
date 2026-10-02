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

/* =========================================================
   FIREBASE CLOUD MESSAGING
========================================================= */

import {
  getMessaging,
  getToken,
  onMessage
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js";


/* =========================================================
   INITIALIZE FIREBASE
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


/* Escape HTML */

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
   CLOUDINARY UPLOAD
========================================================= */

async function uploadToCloudinary(
  file,
  folder = "blaze-panels"
) {

  if (!file) {
    return "";
  }


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
    await fetch(
      endpoint,
      {
        method: "POST",
        body: formData
      }
    );


  const data =
    await response.json();


  if (!response.ok || !data.secure_url) {

    console.error(
      "Cloudinary upload response:",
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

  return new Promise(
    (resolve) => {

      const unsubscribe =
        onAuthStateChanged(
          auth,
          (user) => {

            unsubscribe();

            resolve(user);

          }
        );

    }
  );

}


/* =========================================================
   CREATE USER DOCUMENT
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
    await getDoc(
      userRef
    );


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
   FIREBASE CLOUD MESSAGING
   REQUEST PERMISSION + SAVE TOKEN
========================================================= */

async function saveToken(user) {

  try {

    if (!user) return;


    if (!("Notification" in window)) {

      console.log(
        "This browser does not support notifications."
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
        permission !==
        "granted"
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
        "Notification permission is not granted."
      );

      return;

    }


    const registration =
      await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js"
      );


    console.log(
      "Firebase Messaging Service Worker registered."
    );


    const token =
      await getToken(
        messaging,
        {

          vapidKey:
            vapidKey,

          serviceWorkerRegistration:
            registration

        }
      );


    if (!token) {

      console.log(
        "FCM token was not generated."
      );

      return;

    }


    console.log(
      "FCM Token generated:",
      token
    );


    await setDoc(
      doc(
        db,
        "deviceTokens",
        token
      ),
      {

        userId:
          user.uid,

        token:
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
      "FCM token successfully saved to Firestore."
    );

  } catch (error) {

    console.error(
      "FCM notification setup error:",
      error
    );

  }

}


/* =========================================================
   FOREGROUND MESSAGE
========================================================= */

onMessage(
  messaging,
  (payload) => {

    console.log(
      "Foreground FCM message received:",
      payload
    );


    const title =
      payload.notification?.title ||
      "Blaze Panels";


    const body =
      payload.notification?.body ||
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

            body:
              body,

            icon:
              "/assets/icon.svg"

          }
        );

      } catch (error) {

        console.log(
          "Foreground browser notification error:",
          error
        );

      }

    }


    const user =
      auth.currentUser;


    if (user) {

      notifications(
        user
      );

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


    $("panels").innerHTML =
      "";


    if (snapshot.empty) {

      $("panels").innerHTML = `

        <div class="card">

          <h3>
            No panels available
          </h3>

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
                p.price ||
                0
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


    $("orders").innerHTML =
      "";


    if (snapshot.empty) {

      $("orders").innerHTML = `

        <div class="card">

          <h3>
            No orders yet
          </h3>

          <p class="muted">
            Your purchased panels will appear here.
          </p>

        </div>

      `;

      return;

    }


    snapshot.forEach(
      (document) => {

        const o =
          document.data();


        let buttons =
          "";


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
                      ${esc(
                        o.utr
                      )}

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
   LOAD NOTIFICATIONS
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


    let unread =
      0;


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
   CHECKOUT / BUY PAGE
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
      (
        panel.price ||
        0
      );


    if ($("upi")) {

      $("upi").textContent =
        panel.upi ||
        "";

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

      button.disabled =
        true;

      button.textContent =
        "Connecting...";


      if (msg) {

        msg.textContent =
          "";

      }


      const provider =
        new GoogleAuthProvider();


      provider.setCustomParameters(
        {
          prompt:
            "select_account"
        }
      );


      const result =
        await signInWithPopup(
          auth,
          provider
        );


      const user =
        result.user;


      await ensureUser(
        user
      );


      await saveToken(
        user
      );


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


      button.disabled =
        false;

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

      button.disabled =
        true;

      button.textContent =
        "Connecting...";


      if (msg) {

        msg.textContent =
          "";

      }


      const provider =
        new GoogleAuthProvider();


      provider.setCustomParameters(
        {
          prompt:
            "select_account"
        }
      );


      const result =
        await signInWithPopup(
          auth,
          provider
        );


      const user =
        result.user;


      await ensureUser(
        user
      );


      await saveToken(
        user
      );


      location.href =
        "index.html";

    } catch (error) {

      console.error(
        "Google registration failed:",
        error
      );


      if (msg) {

        msg.textContent =
          error.message ||
          "Google registration failed.";

      }


      button.disabled =
        false;

      button.textContent =
        "Continue with Google";

    }

  }
);


/* =========================================================
   LOGOUT
========================================================= */

$("logout")?.addEventListener(
  "click",
  async () => {

    try {

      await signOut(
        auth
      );


      location.href =
        "index.html";

    } catch (error) {

      console.error(
        "Logout failed:",
        error
      );

    }

  }
);


/* =========================================================
   ENABLE NOTIFICATIONS BUTTON
========================================================= */

$("notify")?.addEventListener(
  "click",
  async () => {

    const user =
      auth.currentUser;


    if (!user) {

      location.href =
        "login.html";

      return;

    }


    await saveToken(
      user
    );


    if ($("notify")) {

      $("notify").textContent =
        Notification.permission ===
        "granted"

          ? "Notifications Enabled"

          : "Notifications Not Enabled";

    }

  }
);


/* =========================================================
   PAYMENT SUBMISSION
   CLOUDINARY PAYMENT PROOF
========================================================= */

$("submitPayment")?.addEventListener(
  "click",
  async () => {

    try {

      const user =
        auth.currentUser;


      if (!user) {

        location.href =
          "login.html";

        return;

      }


      const panel =
        window.checkoutPanel;


      if (!panel) {

        alert(
          "Panel information is not loaded."
        );

        return;

      }


      const utr =
        $("utr")?.value.trim();


      if (!utr) {

        alert(
          "Please enter UTR."
        );

        return;

      }


      const file =
        $("proof")?.files?.[0];


      let proofUrl =
        "";


      /* Upload payment screenshot to Cloudinary */

      if (file) {

        proofUrl =
          await uploadToCloudinary(
            file,
            `blaze-panels/payment-proofs/${user.uid}`
          );

      }


      /* Create order */

      await addDoc(
        collection(
          db,
          "orders"
        ),
        {

          userId:
            user.uid,

          userEmail:
            user.email ||
            "",

          panelId:
            panel.id,

          panelTitle:
            panel.title,

          amount:
            panel.price,

          utr:
            utr,

          proofUrl:
            proofUrl,

          status:
            "pending",

          createdAt:
            serverTimestamp()

        }
      );


      if ($("msg")) {

        $("msg").textContent =
          "Payment proof submitted. Admin approval is required.";

      }


      if ($("utr")) {

        $("utr").value =
          "";

      }


      if ($("proof")) {

        $("proof").value =
          "";

      }

    } catch (error) {

      console.error(
        "Payment submission failed:",
        error
      );


      if ($("msg")) {

        $("msg").textContent =
          error.message;

      }

    }

  }
);


/* =========================================================
   ADMIN - SAVE PANEL
========================================================= */

$("save")?.addEventListener(
  "click",
  async () => {

    try {

      /* =====================================================
         EXISTING URL FIELDS
      ===================================================== */

      let image =
        $("pimage")?.value.trim() ||
        "";

      let previewVideo =
        $("ppreview")?.value.trim() ||
        "";

      let setupUrl =
        $("psetup")?.value.trim() ||
        "";

      let apkUrl =
        $("papk")?.value.trim() ||
        "";


      /* =====================================================
         OPTIONAL CLOUDINARY FILE INPUTS

         If these IDs exist in admin.html:
         pimageFile
         ppreviewFile
         psetupFile

         they will upload automatically.

         If they don't exist, existing URL fields
         continue working exactly as before.
      ===================================================== */


      const imageFile =
        $("pimageFile")?.files?.[0];


      const previewFile =
        $("ppreviewFile")?.files?.[0];


      const setupFile =
        $("psetupFile")?.files?.[0];


      if (imageFile) {

        image =
          await uploadToCloudinary(
            imageFile,
            "blaze-panels/panel-images"
          );

      }


      if (previewFile) {

        previewVideo =
          await uploadToCloudinary(
            previewFile,
            "blaze-panels/preview-videos"
          );

      }


      if (setupFile) {

        setupUrl =
          await uploadToCloudinary(
            setupFile,
            "blaze-panels/setup-videos"
          );

      }


      /* =====================================================
         APK IS STILL EXTERNAL LINK

         Example:
         Google Drive link
      ===================================================== */


      const panel = {

        title:
          $("ptitle")?.value.trim() ||
          "",

        price:
          Number(
            $("pprice")?.value ||
            0
          ),

        image:
          image,

        previewVideo:
          previewVideo,

        apkUrl:
          apkUrl,

        setupUrl:
          setupUrl,

        description:
          $("pdesc")?.value.trim() ||
          "",

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


      editId =
        null;


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

window.delPanel =
  async (id) => {

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

window.editPanel =
  async (id) => {

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


      editId =
        id;


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
              panel[field] ??
              "";

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
                order.utr ||
                ""
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
========================================================= */

window.approve =
  async (id) => {

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


      await updateDoc(
        orderRef,
        {

          status:
            "approved",

          approvedAt:
            serverTimestamp(),

          apkUrl:
            panel.apkUrl ||
            "",

          setupUrl:
            panel.setupUrl ||
            ""

        }
      );


      /* Create user notification */

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
            `${order.panelTitle} is now ready. Open Your Orders to download it and view setup.`,

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


      await pending();


      alert(
        "Order approved."
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
========================================================= */

window.reject =
  async (id) => {

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


      await updateDoc(
        orderRef,
        {

          status:
            "rejected",

          rejectedAt:
            serverTimestamp()

        }
      );


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
            `Your payment for ${order.panelTitle} was not approved. Please contact support.`,

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


      await pending();


      alert(
        "Order rejected."
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
========================================================= */

$("announce")?.addEventListener(
  "click",
  async () => {

    try {

      const title =
        $("atitle")?.value.trim() ||
        "";


      const body =
        $("abody")?.value.trim() ||
        "";


      if (!title || !body) {

        alert(
          "Enter announcement title and message."
        );

        return;

      }


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

            title:
              title,

            body:
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


      await addDoc(
        collection(
          db,
          "announcements"
        ),
        {

          title:
            title,

          body:
            body,

          createdAt:
            serverTimestamp()

        }
      );


      if ($("amsg")) {

        $("amsg").textContent =
          `Announcement created for ${usersSnapshot.size} users.`;

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

    if (user) {

      try {

        await ensureUser(
          user
        );


        await saveToken(
          user
        );


        if ($("name")) {

          $("name").textContent =
            user.displayName ||
            "Account";

        }


        if ($("email")) {

          $("email").textContent =
            user.email ||
            "";

        }


        await orders(
          user
        );


        await notifications(
          user
        );

      } catch (error) {

        console.error(
          "User initialization failed:",
          error
        );

      }

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