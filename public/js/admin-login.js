console.log("Firebase apps:", firebase.apps);

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("loginBtn");
  const errorEl = document.getElementById("error");

  if (!btn) return;

  firebase.auth().onAuthStateChanged(function (user) {
    if (user) {
      window.location.href = "/admin.html";
    }
  });

  btn.addEventListener("click", async () => {
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      window.location.href = "/admin.html";
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      if (errorEl) errorEl.textContent = err.message;
      alert(err.message);
    }
  });
});
