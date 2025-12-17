const admin = require('firebase-admin');

// 1. You must Download your Service Account Key from Firebase Console:
//    Project Settings -> Service accounts -> Generate new private key
//    Save it as 'service-account.json' in this folder.
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// The topic name we subscribed to in the Android App (MyFirebaseMessagingService doesn't explicitly sub, 
// so we usually target 'all' or specific tokens, but here we will target a topic 'all_users' 
// OR you can use the Token registration flow.
// For simplicity in this demo, you often subscribe client-side to a topic. 
// Let's assume we want to send to a conditioned topic or just a test message.
// Note: To make this work best, add `FirebaseMessaging.getInstance().subscribeToTopic("updates");` in Android App.

const topic = 'updates';

const message = {
  notification: {
    title: '🎅 Christmas Offer!',
    body: 'Get 50% off on all Christmas items today! 🎄'
  },
  android: {
    notification: {
      icon: 'ic_launcher',
      color: '#D32F2F', // Christmas Red
      sound: 'default'
    }
  },
  topic: topic
};

console.log(`Sending message to topic: ${topic}...`);

admin.messaging().send(message)
  .then((response) => {
    console.log('Successfully sent message:', response);
  })
  .catch((error) => {
    console.log('Error sending message:', error);
  });
