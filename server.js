const express = require('express');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache');

// Initialisation d'Express
const app = express();
const PORT = process.env.PORT || 3000;

// Initialisation de Firebase Admin
const serviceAccount = require('./key.json'); // Assure-toi que le chemin est correct
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://infofoot-32892-default-rtdb.firebaseio.com'
});

const db = admin.database();
const auth = admin.auth();
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); // Cache avec TTL de 60s

// Middleware
app.use(express.json({ limit: '10kb' }));
app.use(cors({ origin: true, methods: ['GET', 'POST'] }));
app.use(express.static(path.join(__dirname, 'V1', 'main')));
app.use(express.static(path.join(__dirname, 'V1', 'css')));
app.use(express.static(path.join(__dirname, 'V1', 'js')));
app.use(express.static(path.join(__dirname, 'V1', 'res')));
app.use(express.static(path.join(__dirname, 'V1', 'fonts')));

// Configuration de Nodemailer (exemple avec Gmail)
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'nissoulintouchable@gmail.com', // Ton adresse Gmail
        pass: 'zjkv thjb qiln ffaq' // Mot de passe d'application Gmail
    }
});

// Constants
const MINING_DURATION = 3 * 60 * 60 * 1000; // 3 heures en ms
const SECONDS_IN_3H = 3 * 60 * 60; // 10 800 secondes

// Middleware d'authentification
const authenticateUser = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return res.status(401).json({ error: 'No token provided' });

    try {
        const decodedToken = await auth.verifyIdToken(idToken);
        req.userId = decodedToken.uid;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Fonctions utilitaires
const getUserData = async (refPath, cacheKey) => {
    const cachedData = cache.get(cacheKey);
    if (cachedData) return cachedData;

    const snapshot = await db.ref(refPath).once('value');
    const data = snapshot.val() || {};
    cache.set(cacheKey, data);
    return data;
};

const updateMiningStats = async (userId) => {
    const cardsData = await getUserData(`Users/${userId}/cards/`, `cards_${userId}`);
    let totalPower = 0;
    let totalBonus = 0;

    Object.values(cardsData).forEach(card => {
        if (card.active === 1) {
            totalPower += card.puissance || 0;
            totalBonus += card.bonus || 0;
        }
    });

    await db.ref(`Users/${userId}/mining/`).update({
        'puissance-mining': totalPower,
        bonus: totalBonus
    });

    return { totalPower, totalBonus };
};

// Fonction pour envoyer un email de fin de minage
async function sendMiningEndEmail(userId, email) {
    const mailOptions = {
        from: '"Nxo Mining Team" <nissoulintouchable@gmail.com>',
        to: email,
        subject: 'Your Mining Session Has Ended',
        html: `
            <h2>Mining Session Completed</h2>
            <p>Dear User,</p>
            <p>We are pleased to inform you that your mining session has successfully concluded on <strong>${new Date().toLocaleString()}</strong>.</p>
            <p><strong>Mining Details:</strong></p>
            <ul>
                <li>User ID: ${userId}</li>
                <li>Completion Time: ${new Date().toLocaleString()}</li>
            </ul>
            <p>Your mined NXO has been updated in your account. You can now collect your rewards and start a new mining session if desired.</p>
            <p>Thank you for using our mining platform. If you have any questions, feel free to contact us at <a href="mailto:support@nxomining.com">support@nxomining.com</a>.</p>
            <p>Best regards,<br>The Nxo Mining Team</p>
            <footer style="font-size: 12px; color: #777;">
                <p>This is an automated message. Please do not reply directly to this email.</p>
            </footer>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`📧 Email envoyé à ${email} pour la fin du minage de ${userId}`);
    } catch (error) {
        console.error(`❌ Erreur lors de l'envoi de l'email à ${email} :`, error);
    }
}

// Fonction pour vérifier et gérer le minage (de l'ancien server.js)
async function checkMining() {
    console.log("🔍 Vérification du minage...");
    const miningStartRef = db.ref('MiningStart');
    const snapshot = await miningStartRef.once('value');

    if (!snapshot.exists()) return;

    const now = Date.now();

    snapshot.forEach(async (miningEntry) => {
        const userId = miningEntry.key;
        const miningData = miningEntry.val();

        const nextMining = miningData.next || 0;
        const total = miningData.total || 0;
        const totalS = miningData.totalS || 0;

        const userRef = db.ref(`Users/${userId}/mining`);
        const userSnapshot = await userRef.once('value');

        if (!userSnapshot.exists()) {
            console.log(`❌ Erreur : Aucun chemin Users/${userId}/mining trouvé`);
            return;
        }

        const userData = userSnapshot.val();
        let currentNxo = userData.NXO || 0;

        if (now >= nextMining) {
            console.log(`⛔ Minage terminé pour ${userId}`);
            await miningStartRef.child(userId).update({ minage: 'off' });

            if (total !== currentNxo) {
                const difference = total - currentNxo;
                if (difference > 0) {
                    currentNxo += difference;
                    await userRef.update({ NXO: currentNxo });
                    console.log(`✅ NXO ajusté pour ${userId} : ${currentNxo}`);
                }
            }

            const persoRef = db.ref(`Users/${userId}/perso`);
            const persoSnapshot = await persoRef.once('value');
            const persoData = persoSnapshot.val();
            const userEmail = persoData?.email;

            if (userEmail) {
                await sendMiningEndEmail(userId, userEmail);
            } else {
                console.log(`⚠️ Aucun email trouvé pour ${userId}`);
            }

            await miningStartRef.child(userId).remove();
            console.log(`🗑️ Entrée MiningStart/${userId} supprimée`);
        } else {
            console.log(`⛏️ Mise à jour NXO pour ${userId}`);
            const gainPerInterval = totalS / (3600 / 5); // Gain toutes les 5 secondes (1h = 3600s)
            currentNxo += gainPerInterval;
            await userRef.update({ NXO: currentNxo });
            console.log(`✅ Ajout de ${gainPerInterval.toFixed(6)} NXO à ${userId} (Total: ${currentNxo.toFixed(6)})`);
        }
    });
}

// Exécuter la vérification toutes les 5 secondes
setInterval(() => {
    checkMining();
}, 5000);

// Routes statiques
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'V1', 'main', 'landing.html')));

// Routes API
app.get('/check-auth', (req, res) => res.json({ authenticated: false }));

app.post('/signup', async (req, res) => {
    const { name, username, email, password } = req.body;
    if (!name || !username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Tous les champs sont requis' });
    }

    try {
        const usersSnapshot = await db.ref('Users').once('value');
        if (usersSnapshot.exists() && Object.values(usersSnapshot.val()).some(user => user.perso?.username === username)) {
            return res.status(409).json({ success: false, message: 'Nom d’utilisateur déjà pris' });
        }

        const userRecord = await auth.createUser({ email, password, displayName: name });
        const refKey = userRecord.uid;

        await Promise.all([
            db.ref(`Users/${refKey}/perso/`).set({ name, username, email, NexoCoin: 0, Caret: 1 }),
            db.ref(`Users/${refKey}/mining/`).set({ NXO: 0, 'last-mining': 0, 'next-mining': 0, 'puissance-mining': 0.3, bonus: 0, carte: 1 }),
            db.ref(`Users/${refKey}/cards/`).push().set({ name: 'Nxo-Miner V1', energie: 3, puissance: 0.3, active: 0, bonus: 0 })
        ]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/login', async (req, res) => {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Identifiant et mot de passe requis' });
    }

    try {
        let email = identifier;
        if (!identifier.includes('@')) {
            const usersSnapshot = await db.ref('Users').once('value');
            const users = usersSnapshot.val();
            email = Object.values(users).find(user => user.perso?.username === identifier)?.perso?.email;
            if (!email) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
        }

        await auth.getUserByEmail(email);
        res.json({ success: true, email });
    } catch (error) {
        res.status(401).json({ success: false, message: 'Identifiants incorrects' });
    }
});

app.post('/logout', (req, res) => res.json({ success: true }));

app.get('/mining-data/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const miningData = await getUserData(`Users/${userId}/mining/`, `mining_${userId}`);
        res.json({ success: true, miningData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/start-mining/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    if (userId !== req.userId) return res.status(403).json({ error: 'Unauthorized' });

    const miningRef = db.ref(`Users/${userId}/mining/`);
    const cardsRef = db.ref(`Users/${userId}/cards/`);
    const miningStartRef = db.ref(`MiningStart/${userId}`);

    try {
        console.log(`Début démarrage minage pour userId: ${userId}`);

        const miningSnapshot = await miningRef.once('value');
        const miningData = miningSnapshot.val() || {};
        const now = Date.now();
        const nextMiningDuration = 3600 * 1000; // 1 heure en millisecondes

        if (miningData['next-mining'] && now < miningData['next-mining']) {
            return res.status(400).json({ error: 'Minage déjà en cours' });
        }

        const cardsSnapshot = await cardsRef.once('value');
        const cardsData = cardsSnapshot.val() || {};
        let totalPower = 0;

        Object.values(cardsData).forEach(card => {
            if (card.active === 1) {
                totalPower += card.puissance || 0;
            }
        });

        const bonus = miningData.bonus || 0;
        const total = totalPower + bonus;
        const gainPer5Seconds = total / (3600 / 5);

        await miningStartRef.set({
            total: total,
            totalS: total,
            next: now + nextMiningDuration
        });

        const newMiningData = {
            'last-mining': now,
            'next-mining': now + nextMiningDuration,
            NXO: 0,
            'puissance-mining': totalPower,
            bonus: bonus,
            carte: miningData.carte || 1
        };

        await miningRef.set(newMiningData);
        console.log(`Minage démarré pour userId: ${userId}`, newMiningData);

        cache.del(`mining_${userId}`);

        res.json({
            success: true,
            'last-mining': newMiningData['last-mining'],
            'next-mining': newMiningData['next-mining']
        });
    } catch (error) {
        console.error(`Erreur démarrage minage pour userId: ${userId}`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/collect-nxo/:userId', authenticateUser, async (req, res) => {
    const { userId } = req.params;
    if (userId !== req.userId) return res.status(403).json({ error: 'Unauthorized' });

    const miningRef = db.ref(`Users/${userId}/mining/`);
    const persoRef = db.ref(`Users/${userId}/perso/`);

    try {
        console.log(`Début collecte pour userId: ${userId}`);
        const miningSnapshot = await miningRef.once('value');
        const miningData = miningSnapshot.val() || {};
        const nxo = miningData.NXO || 0;

        if (nxo <= 0) return res.status(400).json({ error: 'Aucun NXO à collecter' });

        const persoSnapshot = await persoRef.once('value');
        const persoData = persoSnapshot.val() || {};
        const currentNxoCoin = persoData.NxoCoin || 0;

        const updatedNxoCoin = currentNxoCoin + nxo;
        await persoRef.update({ NxoCoin: updatedNxoCoin });
        await miningRef.update({ NXO: 0 });

        cache.del(`mining_${userId}`);
        cache.del(`perso_${userId}`);

        res.json({
            success: true,
            message: 'NXO collecté',
            updatedNxoCoin: updatedNxoCoin
        });
    } catch (error) {
        console.error(`Erreur lors de la collecte pour userId: ${userId}`, error);
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/cards/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const cardsData = await getUserData(`Users/${userId}/cards/`, `cards_${userId}`);
        const activeCards = Object.entries(cardsData)
            .filter(([_, card]) => card.active === 1)
            .map(([key, card]) => ({ key, ...card }));

        res.json({ success: true, activeCards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/update-mining-stats/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const { totalPower, totalBonus } = await updateMiningStats(userId);
        cache.del(`mining_${userId}`);
        res.json({ success: true, puissance: totalPower, bonus: totalBonus });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Route pour ping (garder le serveur éveillé)
app.get('/ping', (req, res) => {
    res.json({ success: true, message: 'Server is alive' });
});

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`🌍 Serveur démarré sur http://localhost:${PORT}`);
});

// Gestion des erreurs globales
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
