// Firebase config et initialisation
const firebaseConfig = {
    apiKey: "AIzaSyAdo42qfCCYjwvdi5_JthsrDXxcRIxsbE0",
    authDomain: "infofoot-32892.firebaseapp.com",
    databaseURL: "https://infofoot-32892-default-rtdb.firebaseio.com",
    projectId: "infofoot-32892",
    storageBucket: "infofoot-32892.appspot.com",
    messagingSenderId: "439273116379",
    appId: "1:439273116379:web:9eb86071e411f748c772fe"
};

// Initialisation Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

document.addEventListener("DOMContentLoaded", function () {
    const loginBtn = document.getElementById("login");
    const logoutBtn = document.getElementById("logout");
    const startBtn = document.getElementById("start");

    auth.onAuthStateChanged(user => {
        if (user) {
            // L'utilisateur est connecté
            loginBtn.style.display = "none";
            logoutBtn.style.display = "block";
        } else {
            // L'utilisateur n'est pas connecté
            loginBtn.style.display = "block";
            logoutBtn.style.display = "none";
        }
    });

    // Gestion du bouton Start
    startBtn.addEventListener("click", function () {
        auth.onAuthStateChanged(user => {
            if (user) {
                window.location.href = "main.html"; // Redirige vers main.html si connecté
            } else {
                window.location.href = "login-inc.html"; // Redirige vers login-inc.html si non connecté
            }
        });
    });

    // Gestion de la déconnexion
    logoutBtn.addEventListener("click", function () {
        auth.signOut().then(() => {
            window.location.reload(); // Recharge la page après déconnexion
        }).catch(error => {
            console.error("Erreur lors de la déconnexion:", error);
        });
    });
});
