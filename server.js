const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const NodeCache = require('node-cache'); // Ajout de cache local

// Initialisation de Firebase Admin
const serviceAccount = require('./abb.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://infofoot-32892-default-rtdb.firebaseio.com'
});

const app = express();
const db = admin.database();
const auth = admin.auth();
const cache = new NodeCache({ stdTTL: 60, checkperiod: 120 }); // Cache avec TTL de 60s

// Middleware
app.use(express.json({ limit: '10kb' })); // Limiter la taille des requêtes
app.use(cors({ origin: true, methods: ['GET', 'POST'] }));
app.use(express.static(path.join(__dirname, 'V1', 'main')));
app.use(express.static(path.join(__dirname, 'V1', 'css')));
app.use(express.static(path.join(__dirname, 'V1', 'js')));
app.use(express.static(path.join(__dirname, 'V1', 'res')));
app.use(express.static(path.join(__dirname, 'V1', 'fonts')));

// Constants
const MINING_DURATION = 3 * 60 * 1000; // 3 heures en ms
const SECONDS_IN_3H = 3 * 60 * 60; // 10 800 secondes
const PORT = process.env.PORT || 3000;

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

// Routes unifiées pour le minage
app.get('/mining-data/:userId', async (req, res) => {
    const { userId } = req.params;
    try {
        const miningData = await getUserData(`Users/${userId}/mining/`, `mining_${userId}`);
        res.json({ success: true, miningData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Dans server.js, après app.post('/start-mining/:userId', ...)
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

        // Étape 1 : Récupérer les cartes et calculer la puissance totale
        const cardsSnapshot = await cardsRef.once('value');
        const cardsData = cardsSnapshot.val() || {};
        let totalPower = 0;

        Object.values(cardsData).forEach(card => {
            if (card.active === 1) { // Considérer uniquement les cartes actives
                totalPower += card.puissance || 0;
            }
        });

        // Étape 2 : Récupérer bonus existant
        const bonus = miningData.bonus || 0;
        const total = totalPower + bonus;
        const gainPer5Seconds = total / (3600 / 5); // Gain par intervalle de 5 secondes

        // Étape 3 : Mettre à jour MiningStart
        await miningStartRef.set({
            total: total,
            totalS: total,
            next: now + nextMiningDuration
        });

        // Étape 4 : Mettre à jour Users/${userId}/mining avec la nouvelle puissance
        const newMiningData = {
            'last-mining': now,
            'next-mining': now + nextMiningDuration,
            NXO: 0,
            'puissance-mining': totalPower, // Nouvelle valeur calculée depuis cards
            bonus: bonus,
            carte: miningData.carte || 1
        };

        await miningRef.set(newMiningData);
        console.log(`Minage démarré pour userId: ${userId}`, newMiningData);

        // Simulation de mise à jour de NXO toutes les 5 secondes
        let currentNxo = 0;
        const interval = setInterval(async () => {
            const currentTime = Date.now();
            if (currentTime >= now + nextMiningDuration) {
                clearInterval(interval);
                return;
            }
            currentNxo += gainPer5Seconds;
            await miningRef.update({ NXO: currentNxo });
            console.log(`NXO mis à jour pour ${userId}: ${currentNxo}`);
        }, 5000);

        // Invalider le cache
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

        // Étape 1 : Récupérer les données actuelles
        const miningSnapshot = await miningRef.once('value');
        const miningData = miningSnapshot.val() || {};
        const nxo = miningData.NXO || 0;
        console.log(`NXO à collecter: ${nxo}`);

        if (nxo <= 0) return res.status(400).json({ error: 'Aucun NXO à collecter' });

        const persoSnapshot = await persoRef.once('value');
        const persoData = persoSnapshot.val() || {};
        const currentNxoCoin = persoData.NxoCoin || 0;
        console.log(`Current NxoCoin: ${currentNxoCoin}`);

        // Étape 2 : Calculer et mettre à jour NxoCoin dans Users/${userId}/perso/
        const updatedNxoCoin = currentNxoCoin + nxo;
        await persoRef.update({ NxoCoin: updatedNxoCoin });
        console.log(`NxoCoin mis à jour dans Users/${userId}/perso/: ${updatedNxoCoin}`);

        // Étape 3 : Mettre à jour NXO à 0 dans mining
        await miningRef.update({ NXO: 0 });
        console.log(`NXO remis à 0 dans Users/${userId}/mining/`);

        // Invalider le cache
        cache.del(`mining_${userId}`);
        cache.del(`perso_${userId}`);

        // Étape 4 : Renvoyer la réponse avec updatedNxoCoin
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

        // Suppression de la vérification et désactivation des cartes
        res.json({ success: true, activeCards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Fusion des routes bonus et puissance
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

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});

// Gestion des erreurs globales
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});