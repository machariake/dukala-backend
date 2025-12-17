# Backend Scripts

This folder contains scripts to manage your app's server-side features, specifically **Push Notifications**.

## Setup

1. **Install Node.js** (if not already installed).
2. Open this folder in terminal and run:
   ```bash
   npm install
   ```

## Authorization (Important)

To send notifications, you need "Admin" access to your Firebase project.

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Open your project **duka-la-followers-app**.
3. Go to **Project settings** (gear icon) > **Service accounts**.
4. Click **Generate new private key**.
5. Save the downloaded file as `service-account.json` inside this `backend/` folder.

## Sending a Notification

1. Open `send_notification.js` and edit the `title` and `body` of the message.
2. Run the script:
   ```bash
   node send_notification.js
   ```

## Note on Topics
The script sends to the topic `updates`.
For this to work effectively, ensure the Android app is subscribed to this topic.
(I have added the subscription code to `MainActivity.java` in the next step).
