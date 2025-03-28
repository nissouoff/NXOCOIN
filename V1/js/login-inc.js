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


// ✅ Vérifier si l'utilisateur est connecté avant d'afficher la page
fetch('/check-auth')
    .then(res => res.json())
    .then(data => {
        if (data.authenticated) {
            window.location.href = "main.html"; // Rediriger si déjà connecté
        }
    })
    .catch(err => console.error("Erreur de vérification:", err));

// ✅ Connexion
document.getElementById('login-btn').addEventListener('click', async () => {
    const identifier = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    const errorBox = document.getElementById('error');
    const overview = document.querySelector('.overlay');

    overview.style.display = "flex";

    if (!identifier || !password) {
        errorBox.style.display = "flex";
        errorBox.textContent = "Email/Nom d'utilisateur et mot de passe requis.";
        overview.style.display = "none";

        return;
    }

    try {
        // 🔹 Envoyer la requête au serveur
        const response = await fetch('http://localhost:3000/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, password })
        });

        const data = await response.json();

        // 🔹 Vérifier si la connexion côté serveur a réussi
        if (!data.success) {
            errorBox.textContent = data.message;
            errorBox.style.display = "flex";
            overview.style.display = "none";


            return;
        }

        // 🔹 Connexion Firebase avec l'email récupéré
        await firebase.auth().signInWithEmailAndPassword(data.email, password)
            .then(() => {
                window.location.replace("main.html"); // ✅ Rediriger après connexion réussie
            })
            .catch(error => {
                errorBox.style.display = "flex";
                overview.style.display = "none";

                errorBox.textContent = "❌ Erreur d'authentification Firebase.";
            });

    } catch (error) {
        errorBox.style.display = "flex";
        console.error("⚠️ Erreur de connexion :", error);
        errorBox.textContent = "❌ Erreur de connexion. Vérifiez vos identifiants.";
        overview.style.display = "none";

    }
});


// ✅ Inscription
document.getElementById('singup-btn').addEventListener('click', async () => {
    const name = document.getElementById('name-singup').value.trim();
    const username = document.getElementById('username-singup').value.trim();
    const email = document.getElementById('email-singup').value.trim();
    const password = document.getElementById('password-singup').value.trim();
    const confirmPassword = document.getElementById('cpassword-singup').value.trim();
    const errorElement = document.getElementById('error');
    const overview = document.querySelector('.overlay');
    
    overview.style.display = "flex";


    errorElement.textContent = ""; // Effacer les erreurs précédentes

    if (!name || !username || !email || !password || !confirmPassword) {
        errorElement.textContent = "Veuillez remplir tous les champs.";
        overview.style.display = "none";
        return;
    }

    if (password !== confirmPassword) {
        errorElement.textContent = "Les mots de passe ne correspondent pas.";
        errorElement.style.display = "block";
        overview.style.display = "none";
        return;
    }

    try {
        const res = await fetch('/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, name, username })
        });

        const data = await res.json();
        if (!data.success) throw new Error(data.message);
        errorElement.style.display = "none";

        window.location.href = "main.html"; // ✅ Rediriger après inscription réussie
    } catch (error) {
        errorElement.textContent = `❌ ${error.message}`;
        errorElement.style.display = "block";
        overview.style.display = "none";

    }
});

// ✅ Déconnexion (si le bouton existe)
document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await fetch('/logout', { method: 'POST' });
    window.location.href = "login-inc.html"; // Retour à la page de connexion
});

// ✅ Changement entre login et signup (animation)
const btnSignup = document.getElementById('btn');
const btnLogin = document.getElementById('btn2');
const part1 = document.querySelector('.part1');
const part2 = document.querySelector('.part2');

btnSignup.addEventListener('click', (event) => {
    event.preventDefault();
    part1.style.animation = 'fadeOut 0.5s ease forwards';

    setTimeout(() => {
        part1.style.display = 'none';
        part2.style.display = 'flex';
        part2.style.animation = 'fadeIn 0.5s ease forwards';
    }, 500);
});

btnLogin.addEventListener('click', (event) => {
    event.preventDefault();
    part2.style.animation = 'fadeOut 0.5s ease forwards';

    setTimeout(() => {
        part2.style.display = 'none';
        part1.style.display = 'flex';
        part1.style.animation = 'fadeIn 0.5s ease forwards';
    }, 500);
});
