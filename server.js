const admin = require("firebase-admin");
const nodemailer = require("nodemailer");
const cron = require("node-cron");

// Initialisation de Firebase
admin.initializeApp({
  credential: admin.credential.cert(require("./serviceAccountKey.json")),
  databaseURL: "https://infofoot-32892-default-rtdb.firebaseio.com"
});

const db = admin.database();

// Configuration de Nodemailer
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "your-email@gmail.com",
    pass: "your-email-password"
  }
});

// Fonction pour vérifier et mettre à jour le minage
async function checkMining() {
  const minageRef = db.ref("Minage");
  const snapshot = await minageRef.once("value");

  if (!snapshot.exists()) return;

  snapshot.forEach(async (miningEntry) => {
    const keyAleratoire = miningEntry.key;
    const miningData = miningEntry.val();

    if (miningData.minage === "on") {
      const userRef = db.ref(`Users/${keyAleratoire}/mining`);
      const userDataSnapshot = await userRef.once("value");
      if (!userDataSnapshot.exists()) return;

      const { NXO, last_mining, next_mining, puissance_mining, bonus } = userDataSnapshot.val();
      const now = Date.now();

      if (now >= next_mining) {
        // Minage terminé, envoyer un email
        const userPersoRef = db.ref(`Users/${keyAleratoire}/perso`);
        const userPersoSnapshot = await userPersoRef.once("value");
        const userEmail = userPersoSnapshot.val()?.email;

        if (userEmail) {
          await transporter.sendMail({
            from: "your-email@gmail.com",
            to: userEmail,
            subject: "Minage Terminé",
            text: "Votre minage est terminé. Pensez à recommencer !"
          });
        }
      } else {
        // Calcul des NXO à ajouter
        const elapsedTime = (now - last_mining) / (1000 * 60 * 60); // Temps en heures
        let nxoToAdd = Math.min(elapsedTime * puissance_mining + bonus, puissance_mining);

        // Mettre à jour les valeurs
        await userRef.update({
          NXO: NXO + nxoToAdd,
          last_mining: now
        });
      }
    }
  });
}

// Exécuter la fonction toutes les 5 minutes
cron.schedule("*/5 * * * *", () => {
  console.log("Vérification du minage...");
  checkMining();
});

console.log("Serveur de minage démarré...");
