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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

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
        
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN reminder_time VARCHAR(5)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN reminder_frequency VARCHAR(20)`); } catch (e) {}

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
        console.log("Database initialized successfully.");
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

async function triggerPushNotification(userId, message, taskId) {
    try {
        const subsRes = await pool.query('SELECT subscription FROM push_subscriptions WHERE user_id = $1', [userId]);
        const payload = JSON.stringify({ title: 'Manifest Workspace', body: message, taskId: taskId });
        
        for (let row of subsRes.rows) {
            try {
                const sub = JSON.parse(row.subscription);
                await webpush.sendNotification(sub, payload);
            } catch (pushErr) {
                if (pushErr.statusCode === 410 || pushErr.statusCode === 404) {
                    await pool.query('DELETE FROM push_subscriptions WHERE subscription = $1', [row.subscription]);
                }
            }
        }
    } catch (err) {
        console.error("Error routing push notifications:", err);
    }
}

cron.schedule('* * * * *', async () => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;
    const dayOfWeek = now.getDay(); 

    try {
        const res = await pool.query(`
            SELECT id, user_id, title, reminder_frequency, 
            (SELECT json_agg(user_id) FROM task_assignees WHERE task_id = tasks.id) as assignees 
            FROM tasks 
            WHERE reminder_time = $1 AND completed = false
        `, [currentTime]);

        for (let task of res.rows) {
            let shouldSend = false;
            const freq = task.reminder_frequency;

            if (freq === 'daily') {
                shouldSend = true;
            } else if (freq === 'weekdays' && dayOfWeek >= 1 && dayOfWeek <= 5) {
                shouldSend = true;
            } else if (freq === 'weekends' && (dayOfWeek === 0 || dayOfWeek === 6)) {
                shouldSend = true;
            }

            if (shouldSend) {
                const msg = `⏰ Reminder: "${task.title}"`;
                
                await pool.query('INSERT INTO notifications (user_id, message, task_id) VALUES ($1, $2, $3)', [task.user_id, msg, task.id]);
                await triggerPushNotification(task.user_id, msg, task.id);
                
                const assignees = task.assignees || [];
                for (let uid of assignees) {
                    await pool.query('INSERT INTO notifications (user_id, message, task_id) VALUES ($1, $2, $3)', [uid, msg, task.id]);
                    await triggerPushNotification(uid, msg, task.id);
                }
            }
        }
    } catch (err) {
        console.error("Error processing reminders:", err);
    }
});

app.get('/api/user', (req, res) => {
    if (req.isAuthenticated()) res.json({ id: req.user.id, username: req.user.username });
    else res.status(401).json({ error: 'Not logged in' });
});

app.get('/api/users', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username FROM users ORDER BY username ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

app.get('/api/tasks', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, 
                COALESCE(
                    (SELECT json_agg(td.predecessor_id) FROM task_dependencies td WHERE td.successor_id = t.id), '[]'::json
                ) as predecessors,
                COALESCE(
                    (SELECT json_agg(td.successor_id) FROM task_dependencies td WHERE td.predecessor_id = t.id), '[]'::json
                ) as successors,
                COALESCE(
                    (SELECT json_agg(ta.user_id) FROM task_assignees ta WHERE ta.task_id = t.id), '[]'::json
                ) as assignees
            FROM tasks t 
            WHERE t.user_id = $1 OR EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = $1)
            ORDER BY created_at DESC
        `, [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

app.post('/api/tasks', ensureAuthenticated, async (req, res) => {
    const { title, dueDate } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, title, dueDate || null]
        );
        io.emit('workspace-update'); 
        res.status(201).json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create task' });
    }
});

app.put('/api/tasks/:id', ensureAuthenticated, async (req, res) => {
    const { title, description, completed, dueDate, predecessors, assignees, reminderTime, reminderFrequency } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const oldStateRes = await client.query('SELECT completed FROM tasks WHERE id = $1', [req.params.id]);
        const wasCompleted = oldStateRes.rows.length > 0 ? oldStateRes.rows[0].completed : false;
        
        const oldAssigneesRes = await client.query('SELECT user_id FROM task_assignees WHERE task_id = $1', [req.params.id]);
        const oldAssignees = oldAssigneesRes.rows.map(r => r.user_id);

        const updateRes = await client.query(
            `UPDATE tasks SET title = $1, description = $2, completed = $3, due_date = $4, reminder_time = $5, reminder_frequency = $6 
             WHERE id = $7 AND (user_id = $8 OR EXISTS (SELECT 1 FROM task_assignees WHERE task_id = $7 AND user_id = $8))
             RETURNING id, user_id`,
            [title, description || null, completed, dueDate || null, reminderTime || null, reminderFrequency || null, req.params.id, req.user.id]
        );

        if (updateRes.rowCount === 0) {
            throw new Error('Unauthorized to edit this task');
        }
        
        const taskOwnerId = updateRes.rows[0].user_id;

        if (Array.isArray(predecessors)) {
            await client.query('DELETE FROM task_dependencies WHERE successor_id = $1', [req.params.id]);
            for (let pid of predecessors) {
                await client.query('INSERT INTO task_dependencies (predecessor_id, successor_id) VALUES ($1, $2)', [pid, req.params.id]);
            }
        }
        
        if (Array.isArray(assignees)) {
            await client.query('DELETE FROM task_assignees WHERE task_id = $1', [req.params.id]);
            for (let uid of assignees) {
                await client.query('INSERT INTO task_assignees (task_id, user_id) VALUES ($1, $2)', [req.params.id, uid]);
                
                if (!oldAssignees.includes(uid) && uid !== req.user.id) {
                    const msg = `${req.user.username} shared a document/task with you: "${title}"`;
                    await client.query('INSERT INTO notifications (user_id, message, task_id) VALUES ($1, $2, $3)', [uid, msg, req.params.id]);
                    await triggerPushNotification(uid, msg, req.params.id);
                }
            }
        }
        
        if (completed && !wasCompleted) {
            const usersToNotify = new Set(assignees || []);
            usersToNotify.add(taskOwnerId);
            usersToNotify.delete(req.user.id);
            
            for (let uid of usersToNotify) {
                const msg = `${req.user.username} completed: "${title}"`;
                await client.query('INSERT INTO notifications (user_id, message, task_id) VALUES ($1, $2, $3)', [uid, msg, req.params.id]);
                await triggerPushNotification(uid, msg, req.params.id);
            }
        }

        await client.query('COMMIT');
        
        io.emit('workspace-update'); 
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: 'Failed to update task' });
    } finally {
        client.release();
    }
});

app.get('/api/notifications', ensureAuthenticated, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch notifications' });
    }
});

app.post('/api/notifications/:id/read', ensureAuthenticated, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark read' });
    }
});

app.post('/api/notifications/read-all', ensureAuthenticated, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to mark all read' });
    }
});

app.get('/api/push/key', ensureAuthenticated, (req, res) => {
    res.json({ publicKey: vapidPublicKey });
});

app.post('/api/push/subscribe', ensureAuthenticated, async (req, res) => {
    const { subscription } = req.body;
    try {
        const subStr = JSON.stringify(subscription);
        const check = await pool.query('SELECT id FROM push_subscriptions WHERE user_id = $1 AND subscription = $2', [req.user.id, subStr]);
        if (check.rows.length === 0) {
            await pool.query('INSERT INTO push_subscriptions (user_id, subscription) VALUES ($1, $2)', [req.user.id, subStr]);
        }
        res.status(201).json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save subscription' });
    }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

io.on('connection', (socket) => {
    console.log('A user connected via WebSocket');
    socket.on('disconnect', () => {
        console.log('User disconnected');
    });
});

server.listen(PORT, () => console.log(`API running on port ${PORT}`));
