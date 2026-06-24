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
import { google } from 'googleapis';
import multer from 'multer';
import stream from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

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
        try { await pool.query(`ALTER TABLE users ADD COLUMN google_access_token TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN google_refresh_token TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC'`); } catch (e) {}

        await pool.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false, due_date DATE, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN pdf_url VARCHAR(1024)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN audio_url VARCHAR(1024)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN transcription TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN drive_pdf_id VARCHAR(255)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN drive_audio_id VARCHAR(255)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN slide_tracking TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN predecessors JSONB DEFAULT '[]'`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN assignees JSONB DEFAULT '[]'`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN reminder_time VARCHAR(50)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN reminder_frequency VARCHAR(50)`); } catch (e) {}

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
          if (result.rows.length > 0) {
              await pool.query('UPDATE users SET google_access_token = $1, google_refresh_token = COALESCE($2, google_refresh_token) WHERE google_id = $3', [accessToken, refreshToken, profile.id]);
              return done(null, result.rows[0]);
          }
          result = await pool.query('INSERT INTO users (google_id, username, google_access_token, google_refresh_token) VALUES ($1, $2, $3, $4) RETURNING *', [profile.id, profile.displayName, accessToken, refreshToken]);
          return done(null, result.rows[0]);
      } catch (err) { return done(err); }
  }
));

app.get('/auth/google', passport.authenticate('google', { 
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'],
    accessType: 'offline', 
    prompt: 'consent' 
}));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.post('/auth/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.json({ message: 'Logged out' }); }); });

async function ensureAuthenticatedOrApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
        try {
            const inboundHash = crypto.createHash('sha256').update(apiKey).digest('hex');
            const keyResult = await pool.query('SELECT user_id FROM user_api_keys WHERE api_key_hash = $1', [inboundHash]);
            if (keyResult.rows.length > 0) {
                const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [keyResult.rows[0].user_id]);
                if (userResult.rows.length > 0) { req.user = userResult.rows[0]; return next(); }
            }
            return res.status(401).json({ error: 'Invalid API Key' });
        } catch (err) { return res.status(500).json({ error: 'Hash error' }); }
    }
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Auth required' });
}

app.get('/api/user', (req, res) => res.json(req.user || null));

app.get('/api/users', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username FROM users');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Failed fetching users' }); }
});

app.put('/api/user/timezone', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { timezone } = req.body;
    if (!timezone) return res.status(400).json({ error: "Timezone required" });
    try {
        await pool.query('UPDATE users SET timezone = $1 WHERE id = $2', [timezone, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to update timezone' }); }
});

app.post('/api/settings/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { keyName } = req.body;
    try {
        const cleartextKey = 'app_pp_' + crypto.randomBytes(24).toString('hex');
        const secureHash = crypto.createHash('sha256').update(cleartextKey).digest('hex');
        await pool.query('INSERT INTO user_api_keys (user_id, key_name, api_key_hash) VALUES ($1, $2, $3)', [req.user.id, keyName.trim(), secureHash]);
        res.status(201).json({ key: cleartextKey });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/settings/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('SELECT id, key_name, created_at FROM user_api_keys WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]); res.json(result.rows); } 
    catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.delete('/api/settings/keys/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { await pool.query('DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]); res.json({ success: true }); } 
    catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

app.get('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]); res.json(result.rows); } 
    catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => {
    try { const result = await pool.query('INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *', [req.user.id, req.body.title, req.body.dueDate || null]); io.emit('workspace-update'); res.json(result.rows[0]); } 
    catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.put('/api/tasks/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { title, description, completed, dueDate, predecessors, assignees, reminderTime, reminderFrequency, pdf_url, audio_url, transcription, drive_pdf_id, drive_audio_id, slide_tracking } = req.body;
    try {
        await pool.query(`UPDATE tasks SET title=$1, description=$2, completed=$3, due_date=$4, pdf_url=$5, audio_url=$6, transcription=$7, drive_pdf_id=$8, drive_audio_id=$9, slide_tracking=$10, predecessors=$11, assignees=$12, reminder_time=$13, reminder_frequency=$14 WHERE id=$15`, 
            [title, description || null, completed, dueDate || null, pdf_url || null, audio_url || null, transcription || null, drive_pdf_id || null, drive_audio_id || null, slide_tracking || null, JSON.stringify(predecessors || []), JSON.stringify(assignees || []), reminderTime || null, reminderFrequency || null, req.params.id]);
        io.emit('workspace-update'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// PATCH v30.3: Secure Proxy for Google Drive Downloads
app.get('/api/drive/download/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    if (!req.user.google_access_token) return res.status(403).json({ error: 'Google Auth missing.' });
    try {
        const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ access_token: req.user.google_access_token, refresh_token: req.user.google_refresh_token });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        
        const driveRes = await drive.files.get({ fileId: req.params.id, alt: 'media' }, { responseType: 'stream' });
        driveRes.data.pipe(res);
    } catch (err) {
        console.error("Drive API Download Error:", err);
        res.status(500).send('Error downloading file.');
    }
});

app.post('/api/drive/upload', ensureAuthenticatedOrApiKey, upload.single('file'), async (req, res) => {
    if (!req.user.google_access_token) return res.status(403).json({ error: 'Google Auth missing.' });
    try {
        const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ access_token: req.user.google_access_token, refresh_token: req.user.google_refresh_token });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        
        const folderName = 'manifest-ghost';
        let folderId = null;

        const queryResponse = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (queryResponse.data.files && queryResponse.data.files.length > 0) {
            folderId = queryResponse.data.files[0].id;
        } else {
            const folderMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
            const folder = await drive.files.create({ resource: folderMetadata, fields: 'id' });
            folderId = folder.data.id;
        }
        
        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const response = await drive.files.create({
            requestBody: { name: req.file.originalname, parents: [folderId] }, 
            media: { mimeType: req.file.mimetype, body: bufferStream },
            fields: 'id, webViewLink'
        });
        
        res.json({ fileId: response.data.id, link: response.data.webViewLink });
    } catch (err) {
        console.error("Drive API Error:", err);
        res.status(500).json({ error: 'Drive upload failed.' });
    }
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

app.post('/api/push/subscribe', ensureAuthenticatedOrApiKey, (req, res) => {
    const { subscription, timezone } = req.body;
    if (timezone) {
        pool.query(`UPDATE users SET timezone = $1 WHERE id = $2`, [timezone, req.user.id]).catch(console.error);
    }
    res.status(200).json({ success: true, message: "Push and Timezone configured" });
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
server.listen(PORT, () => console.log(`[v30.3 Proxy] Server Running. Port: ${PORT}`));
