import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs'; 
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';
import cron from 'node-cron';
import crypto from 'crypto';
import Stripe from 'stripe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Initialize Stripe Engine
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Web Push setup
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

if (!vapidPublicKey || !vapidPrivateKey) {
    console.log("VAPID Keys not found in environment. Generating temporary keys...");
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
}

webpush.setVapidDetails(
    'mailto:admin@example.com',
    vapidPublicKey,
    vapidPrivateKey
);

// Database connection pool setup
const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

// =========================================================================
// STRIPE WEBHOOK LAYER (MUST EXECUTED BEFORE express.json() RAW BUFFER PARSE)
// =========================================================================
app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`Webhook signature verification failed:`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed': {
            const sessionData = event.data.object;
            await pool.query(
                `UPDATE users SET plan_type = 'pro', stripe_subscription_id = $1 WHERE stripe_customer_id = $2`,
                [sessionData.subscription, sessionData.customer]
            );
            console.log(`Customer ${sessionData.customer} successfully upgraded to PRO tier.`);
            break;
        }
        case 'customer.subscription.deleted': {
            const subscriptionData = event.data.object;
            await pool.query(
                `UPDATE users SET plan_type = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = $1`,
                [subscriptionData.customer]
            );
            console.log(`Subscription ${subscriptionData.id} cancelled. Customer downgraded to FREE.`);
            break;
        }
        default:
            console.log(`Unhandled Stripe event framework update: ${event.type}`);
    }
    res.json({ received: true });
});

// Standard REST parsers activated for subsequent handlers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.SESSION_SECRET || 'ghost_palette_secret_key',
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

// Unified Database Schema Initialization Engine
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                google_id VARCHAR(255) UNIQUE,
                timezone VARCHAR(50) DEFAULT 'UTC',
                stripe_customer_id VARCHAR(255),
                stripe_subscription_id VARCHAR(255),
                plan_type VARCHAR(50) DEFAULT 'free',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title VARCHAR(255) NOT NULL,
                completed BOOLEAN DEFAULT false,
                due_date DATE,
                description TEXT,
                reminder_time VARCHAR(5),
                reminder_frequency VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_api_keys (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                key_name VARCHAR(100) NOT NULL,
                api_key_hash VARCHAR(64) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_dependencies (
                predecessor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                successor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                PRIMARY KEY (predecessor_id, successor_id)
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_assignees (
                task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                PRIMARY KEY (task_id, user_id)
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                message VARCHAR(255) NOT NULL,
                is_read BOOLEAN DEFAULT false,
                task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                subscription TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log("Database schema initialized and verified successfully for v21.");
    } catch (err) {
        console.error("Error running DB setup sequences:", err);
    }
}
initDB();

// Passport Identity Serialization Configuration
passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        done(null, result.rows[0]);
    } catch (err) {
        done(err);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
      try {
          let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
          if (result.rows.length > 0) return done(null, result.rows[0]);
          result = await pool.query(
              'INSERT INTO users (google_id, username) VALUES ($1, $2) RETURNING *',
              [profile.id, profile.displayName]
          );
          return done(null, result.rows[0]);
      } catch (err) { return done(err); }
  }
));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.post('/auth/logout', (req, res, next) => { 
    req.logout((err) => { if (err) return next(err); res.json({ message: 'Logged out' }); }); 
});

// =========================================================================
// MIDDLEWARE INTERCEPTORS (DUAL SESSION/API-KEY AUTH & BILLING TIERS)
// =========================================================================
async function ensureAuthenticatedOrApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    
    if (apiKey) {
        try {
            const inboundHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            const keyResult = await pool.query('SELECT user_id FROM user_api_keys WHERE api_key_hash = $1', [inboundHash]);
            
            if (keyResult.rows.length > 0) {
                const userId = keyResult.rows[0].user_id;
                const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
                if (userResult.rows.length > 0) {
                    req.user = userResult.rows[0]; // Inject stateless request user session context
                    return next(); 
                }
            }
            return res.status(401).json({ error: 'Invalid or revoked custom integration API key parameters.' });
        } catch (err) {
            return res.status(500).json({ error: 'Internal token cryptographic parsing failure.' });
        }
    }

    if (req.isAuthenticated && req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Authentication required. Pass session cookie or structural X-API-Key header.' });
}

function ensureProPlan(req, res, next) {
    if (req.user && req.user.plan_type === 'pro') {
        return next();
    }
    res.status(403).json({ error: 'Payment Required: This premium execution matrix requires an upgraded Pro plan.' });
}

// Regional Profile Configurations
app.get('/api/settings/profile', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT timezone FROM users WHERE id = $1', [req.user.id]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to extract regional user attributes.' });
    }
});

app.put('/api/settings/profile', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { timezone } = req.body;
    try {
        await pool.query('UPDATE users SET timezone = $1 WHERE id = $2', [timezone, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update user timezone metrics.' });
    }
});

// Power Platform Stateless Key Automation Provisions
app.post('/api/settings/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { keyName } = req.body;
    if (!keyName || !keyName.trim()) {
        return res.status(400).json({ error: 'A descriptive connector identification string is required.' });
    }
    try {
        const cleartextKey = 'app_pp_' + crypto.randomBytes(24).toString('hex');
        const secureHash = crypto.createHash('sha256').update(cleartextKey).digest('hex');
        await pool.query(
            'INSERT INTO user_api_keys (user_id, key_name, api_key_hash) VALUES ($1, $2, $3)',
            [req.user.id, keyName.trim(), secureHash]
        );
        res.status(201).json({ key: cleartextKey });
    } catch (err) {
        res.status(500).json({ error: 'Database key serialization deadlock encountered.' });
    }
});

app.get('/api/settings/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, key_name, created_at FROM user_api_keys WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to look up active credentials registry.' });
    }
});

app.delete('/api/settings/keys/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query('DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to purge access authorization sequence.' });
    }
});

// Stripe Checkout Form Session Creation
app.post('/api/checkout', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        let customerId = req.user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: req.user.email || `${req.user.username}@manifestapp.local`,
                metadata: { userId: req.user.id.toString() }
            });
            customerId = customer.id;
            await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
        }

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
            mode: 'subscription',
            success_url: `${req.headers.origin}/?billing=success`,
            cancel_url: `${req.headers.origin}/?billing=cancel`,
        });
        res.json({ url: session.url });
    } catch (err) {
        res.status(500).json({ error: 'Stripe gateway checkout session build crash.' });
    }
});

app.post('/api/billing-portal', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        if (!req.user.stripe_customer_id) {
            return res.status(400).json({ error: 'No structured payment context associated with your login profile.' });
        }
        const portalSession = await stripe.billing_portal.sessions.create({
            customer: req.user.stripe_customer_id,
            return_url: `${req.headers.origin}/`,
        });
        res.json({ url: portalSession.url });
    } catch (err) {
        res.status(500).json({ error: 'Failed to provision self-service subscription portal link.' });
    }
});

// Base Core REST APIs
app.get('/api/user', (req, res) => { res.json(req.user || null); });

app.get('/api/users', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username FROM users ORDER BY username ASC');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Failed to pull system user rosters.' }); }
});

app.get('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, 
                COALESCE((SELECT json_agg(td.predecessor_id) FROM task_dependencies td WHERE td.successor_id = t.id), '[]'::json) as predecessors,
                COALESCE((SELECT json_agg(ta.user_id) FROM task_assignees ta WHERE ta.task_id = t.id), '[]'::json) as assignees
            FROM tasks t 
            WHERE t.user_id = $1 OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
            ORDER BY created_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Failed to sync application workflows map.' }); }
});

app.post('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { title, dueDate } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, title, dueDate || null]
        );
        io.emit('workspace-update'); 
        res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed to populate task context.' }); }
});

app.put('/api/tasks/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { title, description, completed, dueDate, predecessors, assignees, reminderTime, reminderFrequency } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const oldStateRes = await client.query('SELECT completed FROM tasks WHERE id = $1', [req.params.id]);
        const wasCompleted = oldStateRes.rows.length > 0 ? oldStateRes.rows[0].completed : false;

        const updateRes = await client.query(
            `UPDATE tasks SET title = $1, description = $2, completed = $3, due_date = $4, reminder_time = $5, reminder_frequency = $6 
             WHERE id = $7 RETURNING id, user_id`,
            [title, description || null, completed, dueDate || null, reminderTime || null, reminderFrequency || null, req.params.id]
        );

        if (updateRes.rowCount === 0) throw new Error('Unauthorized operational parameters.');

        if (Array.isArray(predecessors)) {
            await client.query('DELETE FROM task_dependencies WHERE successor_id = $1', [req.params.id]);
            for (let pid of predecessors) {
                if(pid) await client.query('INSERT INTO task_dependencies (predecessor_id, successor_id) VALUES ($1, $2)', [pid, req.params.id]);
            }
        }
        
        if (Array.isArray(assignees)) {
            await client.query('DELETE FROM task_assignees WHERE task_id = $1', [req.params.id]);
            for (let uid of assignees) {
                if(uid) {
                    await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [req.params.id, uid]);
                    if (uid !== req.user.id) {
                        const msg = `${req.user.username} shared workspace document: "${title}"`;
                        await client.query('INSERT INTO notifications (user_id, message, task_id) VALUES ($1, $2, $3)', [uid, msg, req.params.id]);
                        await triggerPushNotification(uid, msg, req.params.id);
                    }
                }
            }
        }

        await client.query('COMMIT');
        io.emit('workspace-update'); 
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Transactional modification rollbacked.' });
    } finally {
        client.release();
    }
});

// Notifications and Web Push
app.get('/api/notifications', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Notifications pulling layer exception.' }); }
});

app.post('/api/notifications/:id/read', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to acknowledge notice visibility state.' }); }
});

app.post('/api/notifications/read-all', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to clean notifications dashboard indices.' }); }
});

app.get('/api/push/key', ensureAuthenticatedOrApiKey, (req, res) => { res.json({ publicKey: vapidPublicKey }); });

app.post('/api/push/subscribe', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { subscription } = req.body;
    try {
        const subStr = JSON.stringify(subscription);
        const check = await pool.query('SELECT id FROM push_subscriptions WHERE user_id = $1 AND subscription = $2', [req.user.id, subStr]);
        if (check.rows.length === 0) {
            await pool.query('INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)', [req.user.id, subStr]);
        }
        res.status(201).json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Push synchronization endpoint registration faulted.' }); }
});

async function triggerPushNotification(userId, message, taskId) {
    try {
        const subsRes = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
        const payload = JSON.stringify({ title: 'Manifest Workspace', body: message, taskId: taskId });
        for (let row of subsRes.rows) {
            try {
                await webpush.sendNotification(JSON.parse(row.subscription), payload);
            } catch (pushErr) {
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await pool.query('DELETE FROM push_subscriptions WHERE subscription = $1', [row.subscription]);
                }
            }
        }
    } catch (err) { console.error("Push routing execution error:", err); }
}

// =========================================================================
// REGIONALIZED CHRONOLOGICAL DAEMON TRACKER ENGINE (CROSS-TIMEZONE REMINDERS)
// =========================================================================
cron.schedule('* * * * *', async () => {
    try {
        const res = await pool.query(`
            SELECT t.id, t.user_id, t.title, t.reminder_frequency,
            EXTRACT(DOW FROM CURRENT_TIMESTAMP AT TIME ZONE COALESCE(u.timezone, 'UTC')) as local_dow,
            (SELECT json_agg(user_id) FROM task_assignees WHERE task_id = t.id) as assignees
            FROM tasks t
            JOIN users u ON t.user_id = u.id
            WHERE t.completed = false 
              AND t.reminder_time = to_char(CURRENT_TIMESTAMP AT TIME ZONE COALESCE(u.timezone, 'UTC'), 'HH24:MI')
        `);

        for (let task of res.rows) {
            let shouldSend = false;
            const freq = task.reminder_frequency;
            const dayOfWeek = parseInt(task.local_dow, 10); 

            if (freq === 'daily') shouldSend = true;
            else if (freq === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) shouldSend = true;
            else if (freq === 'weekends' && (dayOfWeek === 0 || dayOfWeek === 6)) shouldSend = true;

            if (shouldSend) {
                const msg = `⏰ Reminder: "${task.title}" requires configuration review.`;
                const usersToNotify = new Set([task.user_id, ...(task.assignees || [])]);
                
                for(let uid of usersToNotify){
                    await pool.query('INSERT INTO notifications (user_id, message, task_id) VALUES ($1, $2, $3)', [uid, msg, task.id]);
                    await triggerPushNotification(uid, msg, task.id);
                }
            }
        }
    } catch (err) { console.error("Cron notification loop exception parsing:", err); }
});

// Premium High-Performance Server-Side Transcription Demo Route Mapped
app.post('/api/notes/transcribe-server', ensureAuthenticatedOrApiKey, ensureProPlan, async (req, res) => {
    res.json({ success: true, message: "Processing core audio stream using cloud Whisper optimized backend execution model." });
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

io.on('connection', (socket) => { console.log('Node client paired inside websocket dynamic layer.'); });
server.listen(PORT, () => console.log(`Unified Service layer booting completed running on interface target: ${PORT}`));