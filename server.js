import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import pg from 'pg';
const { Pool } = pg;
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import Stripe from 'stripe';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT || 5432,
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'ghost_palette_secret_key', resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE, google_id VARCHAR(255) UNIQUE, plan_type VARCHAR(50) DEFAULT 'free', stripe_customer_id VARCHAR(255));`);
        await pool.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false, due_date DATE, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        // Add Study Mode columns safely
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN pdf_url VARCHAR(1024)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN audio_url VARCHAR(1024)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN transcription TEXT`); } catch (e) {}
        
        // Restore API Keys table for Power Automate integration
        await pool.query(`CREATE TABLE IF NOT EXISTS user_api_keys (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, key_name VARCHAR(100) NOT NULL, api_key_hash VARCHAR(64) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
    } catch (err) { console.error("DB Error:", err); }
}
initDB();

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try { const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]); done(null, result.rows[0]); } catch (err) { done(err); }
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

// Restore dual auth check (Session + Custom API Key) for Power Automate support
async function ensureAuthenticatedOrApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
        try {
            const inboundHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            const keyResult = await pool.query('SELECT user_id FROM user_api_keys WHERE api_key_hash = $1', [inboundHash]);
            if (keyResult.rows.length > 0) {
                const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [keyResult.rows[0].user_id]);
                if (userResult.rows.length > 0) {
                    req.user = userResult.rows[0];
                    return next(); 
                }
            }
            return res.status(401).json({ error: 'Invalid API Key' });
        } catch (err) { return res.status(500).json({ error: 'Hash error' }); }
    }
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Auth required' });
}

app.get('/api/user', (req, res) => res.json(req.user || null));

// API Keys Endpoints (Restored)
app.post('/api/settings/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { keyName } = req.body;
    if (!keyName) return res.status(400).json({ error: 'Key name required.' });
    try {
        const cleartextKey = 'app_pp_' + crypto.randomBytes(24).toString('hex');
        const secureHash = crypto.createHash('sha256').update(cleartextKey).digest('hex');
        await pool.query('INSERT INTO user_api_keys (user_id, key_name, api_key_hash) VALUES ($1, $2, $3)', [req.user.id, keyName.trim(), secureHash]);
        res.status(201).json({ key: cleartextKey });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/settings/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, key_name, created_at FROM user_api_keys WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.delete('/api/settings/keys/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query('DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]); res.json(result.rows); } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
app.post('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *', [req.user.id, req.body.title, req.body.dueDate || null]); io.emit('workspace-update'); res.json(result.rows[0]); } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
app.put('/api/tasks/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { title, description, completed, dueDate, pdf_url, audio_url, transcription } = req.body;
    try {
        await pool.query(`UPDATE tasks SET title=$1, description=$2, completed=$3, due_date=$4, pdf_url=$5, audio_url=$6, transcription=$7 WHERE id=$8`, 
            [title, description || null, completed, dueDate || null, pdf_url || null, audio_url || null, transcription || null, req.params.id]);
        io.emit('workspace-update'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/checkout', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        let customerId = req.user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({ email: 'user@example.com', metadata: { userId: req.user.id.toString() } });
            customerId = customer.id;
            await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
        }
        const session = await stripe.checkout.sessions.create({ customer: customerId, payment_method_types: ['card'], line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }], mode: 'subscription', success_url: `${req.headers.origin}/?billing=success`, cancel_url: `${req.headers.origin}/?billing=cancel` });
        res.json({ url: session.url });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
server.listen(PORT, () => console.log(`[v27 Backend] RESTORED BASELINE v20 Features. Port: ${PORT}`));