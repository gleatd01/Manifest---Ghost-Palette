import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import session from 'express-session';
import pg from 'pg';
const { Pool } = pg;
import bcrypt from 'bcryptjs'; 
import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'ghost_palette_secret_key',
    resave: false,
    saveUninitialized: false,
}));
app.use(passport.initialize());
app.use(passport.session());

const pool = new Pool({
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT || 5432,
});

async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(100) UNIQUE,
                password VARCHAR(255),
                google_id VARCHAR(255) UNIQUE,
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        // V3 Additions: Junction table for Predecessors / Successors
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_dependencies (
                predecessor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                successor_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
                PRIMARY KEY (predecessor_id, successor_id)
            );
        `);
        console.log("Database tables verified/updated for Dependencies.");
    } catch (err) {
        console.error("Error initializing DB:", err);
    }
}
initDB();

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

app.get('/auth/google', passport.authenticate('google', { scope: ['profile'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.post('/auth/logout', (req, res, next) => { req.logout((err) => { if (err) return next(err); res.json({ message: 'Logged out' }); }); });

const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) res.json({ id: req.user.id, username: req.user.username });
    else res.status(401).json({ error: 'Not logged in' });
});

// Get Tasks WITH Dependencies
app.get('/api/tasks', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, 
                COALESCE(
                    (SELECT json_agg(td.predecessor_id) FROM task_dependencies td WHERE td.successor_id = t.id), '[]'::json
                ) as predecessors,
                COALESCE(
                    (SELECT json_agg(td.successor_id) FROM task_dependencies td WHERE td.predecessor_id = t.id), '[]'::json
                ) as successors
            FROM tasks t 
            WHERE t.user_id = $1 
            ORDER BY created_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// Create Task
app.post('/api/tasks', ensureAuthenticated, async (req, res) => {
    const { title, dueDate } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, title, dueDate || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// Update Task (Completion, Description, Due Date, Dependencies)
app.put('/api/tasks/:id', ensureAuthenticated, async (req, res) => {
    const { title, description, completed, dueDate, predecessors } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        await client.query(
            `UPDATE tasks SET title = $1, description = $2, completed = $3, due_date = $4 WHERE id = $5 AND user_id = $6`,
            [title, description || null, completed, dueDate || null, req.params.id, req.user.id]
        );

        if (Array.isArray(predecessors)) {
            await client.query('DELETE FROM task_dependencies WHERE successor_id = $1', [req.params.id]);
            for (let pid of predecessors) {
                await client.query('INSERT INTO task_dependencies (predecessor_id, successor_id) VALUES ($1, $2)', [pid, req.params.id]);
            }
        }

        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to update task' });
    } finally {
        client.release();
    }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

app.listen(PORT, () => console.log(`API running on port ${PORT}`));