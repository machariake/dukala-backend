
const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const path = require('path');
const session = require('express-session');
const cron = require('node-cron');
const app = express();
const port = process.env.PORT || 3000;

// Initialize Firebase
let serviceAccount;
if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
        serviceAccount = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
        console.error("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON", e);
    }
} else {
    try {
        serviceAccount = require('./service-account.json');
    } catch (e) {
        console.warn("Local service-account.json not found.");
    }
}

// Check if app is already initialized to avoid hot-reload errors
if (admin.apps.length === 0 && serviceAccount) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore(); // Use Firestore

app.use(bodyParser.json());
// Session Setup for Auth
app.use(session({
    secret: 'duka-secret-key-123',
    resave: false,
    saveUninitialized: true
}));

const ADMIN_PASS = 'venom1';

// Middleware to protect routes
const isAuthenticated = (req, res, next) => {
    if (req.session.loggedIn) {
        next();
    } else {
        res.status(401).send({ error: 'Unauthorized. Please login.' });
    }
};

// Static files (Login page is public, Dashboard is protected logic handled below or via separated HTMLs)
// For simplicity, we serve login.html as /login and protect index.html logic via API checks
app.use(express.static('public'));

// --- ROUTES ---

// 0. Auth
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASS) {
        req.session.loggedIn = true;
        res.send({ success: true });
    } else {
        res.status(401).send({ error: 'Incorrect Password' });
    }
});

app.get('/api/check-auth', (req, res) => {
    res.send({ loggedIn: !!req.session.loggedIn });
});

app.post('/api/logout', (req, res) => {
    req.session.loggedIn = false;
    res.send({ success: true });
});

// 1. Send Notification (with Scheduling & Deep Link)
app.post('/api/send-notification', isAuthenticated, async (req, res) => {
    const { title, body, type, mediaUrl, isHighAlert, targetUrl, scheduledTime } = req.body;

    // ScheduledTime format: ISO string or '2023-12-...'

    if (!title || !body) {
        return res.status(400).send({ error: 'Title and Body are required' });
    }

    const payload = {
        notification: { title, body },
        data: {
            type: type || 'text',
            mediaUrl: mediaUrl || '',
            isHighAlert: isHighAlert ? 'true' : 'false',
            targetUrl: targetUrl || '' // Deep Link
        },
        android: {
            notification: {
                icon: 'ic_launcher',
                color: '#D32F2F',
                channelId: isHighAlert ? 'high_importance_channel' : 'default_channel',
                priority: isHighAlert ? 'high' : 'normal',
                sound: isHighAlert ? 'default' : undefined
            }
        },
        topic: 'updates'
    };

    const saveToHistory = async () => {
        await db.collection('notifications').add({
            title, body, type: type || 'text', mediaUrl: mediaUrl || '',
            isHighAlert: !!isHighAlert, targetUrl: targetUrl || '',
            date: new Date().toISOString(),
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    };

    if (scheduledTime) {
        // Simple scheduling: Parse date and schedule with node-cron
        // Note: node-cron expects 'min hour day month dow'. 
        // For distinct dates, we can use `setTimeOut` if close, or a proper job queue. 
        // For this "hacky" local server, we calculate delay.
        const delay = new Date(scheduledTime).getTime() - new Date().getTime();

        if (delay > 0) {
            setTimeout(async () => {
                try {
                    await admin.messaging().send(payload);
                    await saveToHistory();
                    console.log('Scheduled notification sent');
                } catch (e) { console.error(e); }
            }, delay);
            return res.send({ success: true, message: 'Scheduled' });
        }
    }

    try {
        const response = await admin.messaging().send(payload);
        await saveToHistory();
        res.send({ success: true, messageId: response });
    } catch (error) {
        console.error('Error sending notification:', error);
        res.status(500).send({ error: error.message });
    }
});

// 2. Get Notification History (Protected)
app.get('/api/notifications', isAuthenticated, async (req, res) => {
    try {
        const snapshot = await db.collection('notifications').orderBy('timestamp', 'desc').get();
        const history = [];
        snapshot.forEach(doc => {
            history.push({ id: doc.id, ...doc.data() });
        });
        res.json(history);
    } catch (error) {
        console.error('Error fetching history:', error);
        res.status(500).send({ error: error.message });
    }
});

// 3. Delete Notification
app.delete('/api/notifications/:id', isAuthenticated, async (req, res) => {
    try {
        await db.collection('notifications').doc(req.params.id).delete();
        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

// 4. Update (Edit)
app.put('/api/notifications/:id', isAuthenticated, async (req, res) => {
    try {
        const { title, body } = req.body;
        await db.collection('notifications').doc(req.params.id).update({ title, body });
        res.send({ success: true });
    } catch (error) { res.status(500).send({ error: error.message }); }
});

// 5. Remote Config Management (Enhanced with Tawk)
app.get('/api/config', isAuthenticated, async (req, res) => {
    try {
        const template = await admin.remoteConfig().getTemplate();
        const p = template.parameters || {};

        res.send({
            christmas_enabled: p['christmas_enabled']?.defaultValue?.value === 'true',
            admin_hidden: p['admin_hidden']?.defaultValue?.value === 'true',
            maintenance_mode: p['maintenance_mode']?.defaultValue?.value === 'true',
            banner_text: p['banner_text']?.defaultValue?.value || "",
            // New Features
            app_logo_url: p['app_logo_url']?.defaultValue?.value || "",
            latest_version_code: p['latest_version_code']?.defaultValue?.value || "1",
            update_url: p['update_url']?.defaultValue?.value || "",
            force_update: p['force_update']?.defaultValue?.value === 'true',
            // Tawk
            tawk_link: p['tawk_link']?.defaultValue?.value || "",
            use_tawk: p['use_tawk']?.defaultValue?.value === 'true',
            // WhatsApp
            whatsapp_number: p['whatsapp_number']?.defaultValue?.value || "+254702716440"
        });
    } catch (error) {
        console.error('Error getting config:', error);
        res.status(500).send({ error: error.message });
    }
});

app.post('/api/update-config', isAuthenticated, async (req, res) => {
    const body = req.body;
    try {
        let template;
        try {
            template = await admin.remoteConfig().getTemplate();
        } catch (e) {
            template = admin.remoteConfig().createTemplateFromJSON({ parameters: {} });
        }
        if (!template.parameters) template.parameters = {};

        const setParam = (key, val, type = 'STRING') => {
            template.parameters[key] = {
                defaultValue: { value: val.toString() },
                valueType: type
            };
        };

        setParam('christmas_enabled', body.christmas_enabled, 'BOOLEAN');
        setParam('admin_hidden', body.admin_hidden, 'BOOLEAN');
        setParam('maintenance_mode', body.maintenance_mode, 'BOOLEAN');
        setParam('banner_text', body.banner_text || "");

        // New Params
        setParam('app_logo_url', body.app_logo_url || "");
        setParam('latest_version_code', body.latest_version_code || "1");
        setParam('update_url', body.update_url || "");
        setParam('force_update', body.force_update || false, 'BOOLEAN');

        // Tawk
        setParam('tawk_link', body.tawk_link || "");
        setParam('use_tawk', body.use_tawk || false, 'BOOLEAN');

        // WhatsApp
        setParam('whatsapp_number', body.whatsapp_number || "+254702716440");

        const validatedTemplate = await admin.remoteConfig().validateTemplate(template);
        await admin.remoteConfig().publishTemplate(validatedTemplate);

        res.send({ success: true });
    } catch (error) {
        console.error('Error updating config:', error);
        res.status(500).send({ error: error.message });
    }
});

// 6. Dashboard Statistics
app.get('/api/stats', async (req, res) => {
    try {
        // Count notifications
        // Note: aggregation queries are cheaper/faster in Firestore but generic count is fine for small apps
        const snapshot = await db.collection('notifications').count().get();
        const count = snapshot.data().count;

        res.send({
            total_notifications: count,
            server_time: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).send({ error: error.message });
    }
});

// --- REVIEWS & TESTIMONIALS ---
app.post('/api/reviews', isAuthenticated, async (req, res) => {
    try {
        const { name, text, rating } = req.body;
        await db.collection('reviews').add({
            name, text, rating: Number(rating),
            approved: false, // Moderation
            date: new Date().toISOString()
        });
        res.send({ success: true });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.get('/api/reviews', async (req, res) => {
    try {
        // Only show approved reviews publicly, but show all to admin
        // For simplicity here, we show all if param 'all' is present
        const snapshot = await db.collection('reviews').orderBy('date', 'desc').get();
        const list = [];
        snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        res.json(list);
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.put('/api/reviews/:id/approve', isAuthenticated, async (req, res) => {
    try {
        await db.collection('reviews').doc(req.params.id).update({ approved: true });
        res.send({ success: true });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.delete('/api/reviews/:id', isAuthenticated, async (req, res) => {
    try {
        await db.collection('reviews').doc(req.params.id).delete();
        res.send({ success: true });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

// --- COUPONS ---
app.post('/api/coupons', isAuthenticated, async (req, res) => {
    try {
        const { code, discount, type } = req.body; // type: 'percent', 'amount'
        await db.collection('coupons').add({
            code: code.toUpperCase(),
            discount: Number(discount),
            type: type || 'percent',
            active: true
        });
        res.send({ success: true });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.get('/api/coupons', isAuthenticated, async (req, res) => {
    try {
        const snapshot = await db.collection('coupons').get();
        const list = [];
        snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
        res.json(list);
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.delete('/api/coupons/:id', isAuthenticated, async (req, res) => {
    try {
        await db.collection('coupons').doc(req.params.id).delete();
        res.send({ success: true });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

// --- USER POINTS  ---
// (Mock implementation: In production, link to User Auth ID)
app.post('/api/user/points', isAuthenticated, async (req, res) => {
    try {
        const { userId, points } = req.body;
        // await db.collection('users').doc(userId).update({ points: admin.firestore.FieldValue.increment(points) });
        res.send({ success: true, message: 'Points added (Simulated)' });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

// --- SERVICE STATUS ---
app.get('/api/service-status', async (req, res) => {
    try {
        const doc = await db.collection('system').doc('service_status').get();
        if (!doc.exists) {
            return res.json({
                instagram: 'operational',
                tiktok: 'operational',
                facebook: 'operational',
                youtube: 'operational'
            }); // Default
        }
        res.json(doc.data());
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.post('/api/service-status', isAuthenticated, async (req, res) => {
    try {
        await db.collection('system').doc('service_status').set(req.body, { merge: true });
        res.send({ success: true });
    } catch (e) { res.status(500).send({ error: e.message }); }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
