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
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
if (!vapidPublicKey || !vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys();
    vapidPublicKey = keys.publicKey;
    vapidPrivateKey = keys.privateKey;
}
webpush.setVapidDetails('mailto:admin@example.com', vapidPublicKey, vapidPrivateKey);

// CRITICAL FIX: Restored backwards compatibility with v20 explicit POSTGRES_ variables 
// to prevent "ECONNREFUSED ::1:5432" errors when DATABASE_URL is undefined.
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT || 5432,
});

app.post('/api/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    try {
        const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        if (event.type === 'checkout.session.completed') {
            await pool.query(`UPDATE users SET plan_type = 'pro', stripe_subscription_id = $1 WHERE stripe_customer_id = $2`, [event.data.object.subscription, event.data.object.customer]);
        } else if (event.type === 'customer.subscription.deleted') {
            await pool.query(`UPDATE users SET plan_type = 'free', stripe_subscription_id = NULL WHERE stripe_customer_id = $1`, [event.data.object.customer]);
        }
        res.json({ received: true });
    } catch (err) { res.status(400).send(`Webhook Error: ${err.message}`); }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'ghost_palette_secret_key', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE, password VARCHAR(255), google_id VARCHAR(255) UNIQUE, timezone VARCHAR(50) DEFAULT 'UTC', stripe_customer_id VARCHAR(255), stripe_subscription_id VARCHAR(255), plan_type VARCHAR(50) DEFAULT 'free', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false, due_date DATE, description TEXT, reminder_time VARCHAR(5), reminder_frequency VARCHAR(20), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS user_api_keys (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, key_name VARCHAR(100) NOT NULL, api_key_hash VARCHAR(64) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS task_dependencies (predecessor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, successor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, PRIMARY KEY (predecessor_id, successor_id));`);
        await pool.query(`CREATE TABLE IF NOT EXISTS task_assignees (task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, PRIMARY KEY (task_id, user_id));`);
        await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, message VARCHAR(255) NOT NULL, is_read BOOLEAN DEFAULT false, task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        await pool.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, subscription TEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    } catch (err) { console.error("DB Initialization Error:", err); }
}
initDB();

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try { const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]); done(null, result.rows[0]); } 
    catch (err) { done(err); }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'mock',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'mock',
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
      try {
          let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
          if (result.rows.length > 0) return done(null, result.rows[0]);
          result = await pool.query('INSERT INTO users (google_id, username) VALUES ($1, $2) RETURNING *', [profile.id, profile.displayName]);
          return done(null, result.rows[0]);
      } catch (err) { return done(err); }
  }
));

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.post('/auth/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.json({ message: 'Logged out' }); }); });

async function ensureAuthenticatedOrApiKey(req, res, next) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Authentication required.' });
}

app.get('/api/user', (req, res) => { res.json(req.user || null); });
app.get('/api/users', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('SELECT id, username FROM users ORDER BY username ASC'); res.json(result.rows); } 
    catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query(`SELECT t.*, COALESCE((SELECT json_agg(td.predecessor_id) FROM task_dependencies td WHERE td.successor_id = t.id), '[]'::json) as predecessors, COALESCE((SELECT json_agg(ta.user_id) FROM task_assignees ta WHERE ta.task_id = t.id), '[]'::json) as assignees FROM tasks t WHERE t.user_id = $1 OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1) ORDER BY created_at DESC`, [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Failed to sync application workflows map.' }); }
});

app.post('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *', [req.user.id, req.body.title, req.body.dueDate || null]);
        io.emit('workspace-update'); res.status(201).json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/tasks/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query(`UPDATE tasks SET title = $1, description = $2, completed = $3, due_date = $4 WHERE id = $5`, [req.body.title, req.body.description || null, req.body.completed, req.body.dueDate || null, req.params.id]);
        io.emit('workspace-update'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.get('/api/notifications', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [req.user.id]); res.json(result.rows); } 
    catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/checkout', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        let customerId = req.user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({ email: req.user.email || 'user@example.com', metadata: { userId: req.user.id.toString() } });
            customerId = customer.id;
            await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
        }
        const session = await stripe.checkout.sessions.create({ customer: customerId, payment_method_types: ['card'], line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }], mode: 'subscription', success_url: `${req.headers.origin}/?billing=success`, cancel_url: `${req.headers.origin}/?billing=cancel` });
        res.json({ url: session.url });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

server.listen(PORT, () => console.log(`[v24 Backend] Port: ${PORT}`));