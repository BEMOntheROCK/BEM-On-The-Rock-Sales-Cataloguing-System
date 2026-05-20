// Import the core Firebase SDK functions directly from the web (CDN)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyA6CqJYfiT8nP3jT_AxpZ-vNccq1Fa0ZKI",
  authDomain: "bemotr-cataloguing-system.firebaseapp.com",
  projectId: "bemotr-cataloguing-system",
  storageBucket: "bemotr-cataloguing-system.firebasestorage.app",
  messagingSenderId: "1043973198739",
  appId: "1:1043973198739:web:afb1f5a5478c22e4948e66",
  measurementId: "G-TPLBJJXNL3"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
// Initialize Cloud Firestore
const db = getFirestore(app);

console.log("BEM On The Rock database connection established!");

// Export the database instance so other script files can use it
export { db };