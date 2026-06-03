const { initializeApp } = require('firebase/app');
const { getFirestore } = require('firebase/firestore');

const firebaseConfig = {
  apiKey: "AIzaSyD4HPydu6Ntu-0QKkesXkg_hQKE4Qw8r9Y",
  authDomain: "robotica-5f161.firebaseapp.com",
  projectId: "robotica-5f161",
  storageBucket: "robotica-5f161.firebasestorage.app",
  messagingSenderId: "526052591797",
  appId: "1:526052591797:web:63b21a11d10e5068aad6fc"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

module.exports = { app, db };
