import zipfile

files = {}

files["Dockerfile"] = """
# Stage 1: Build the Frontend Chunks
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Production Container Runtime
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY server.js ./
COPY --from=build /app/dist ./dist
EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "server.js"]
"""

files[".dockerignore"] = """
node_modules
dist
.env
.git
.gitignore
README.md
Dockerfile
*.zip
"""

files["package.json"] = """{
  "name": "manifest-ghost-palette",
  "version": "31.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev:frontend": "vite",
    "dev:backend": "nodemon server.js",
    "dev": "concurrently \\"npm run dev:backend\\" \\"npm run dev:frontend\\"",
    "build": "vite build",
    "preview": "vite preview",
    "start": "node server.js"
  },
  "dependencies": {
    "bcryptjs": "^2.4.3",
    "concurrently": "^8.2.2",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "express-session": "^1.18.0",
    "googleapis": "^134.0.0",
    "multer": "^1.4.5-lts.1",
    "node-cron": "^3.0.3",
    "passport": "^0.7.0",
    "passport-google-oauth20": "^2.0.0",
    "passport-local": "^1.0.0",
    "pdfjs-dist": "^3.11.174",
    "pg": "^8.11.5",
    "socket.io": "^4.7.5",
    "socket.io-client": "^4.7.5",
    "stripe": "^14.22.0",
    "web-push": "^3.6.7"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^3.1.1",
    "nodemon": "^3.1.0",
    "svelte": "^4.2.18",
    "vite": "^5.2.11"
  }
}"""

files["vite.config.js"] = """import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/auth': { target: 'http://localhost:3000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3000', ws: true }
    }
  }
});
"""

files["server.js"] = """import dotenv from 'dotenv';
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

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

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'], accessType: 'offline', prompt: 'consent' }));
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
app.get('/api/users', ensureAuthenticatedOrApiKey, async (req, res) => { try { const result = await pool.query('SELECT id, username FROM users'); res.json(result.rows); } catch (err) { res.status(500).json({ error: 'Failed' }); } });

app.get('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => { try { const result = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]); res.json(result.rows); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.post('/api/tasks', ensureAuthenticatedOrApiKey, async (req, res) => { try { const result = await pool.query('INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *', [req.user.id, req.body.title, req.body.dueDate || null]); io.emit('workspace-update'); res.json(result.rows[0]); } catch (err) { res.status(500).json({ error: 'Failed' }); } });
app.put('/api/tasks/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { title, description, completed, dueDate, predecessors, assignees, reminderTime, reminderFrequency, pdf_url, audio_url, transcription, drive_pdf_id, drive_audio_id, slide_tracking } = req.body;
    try {
        await pool.query(`UPDATE tasks SET title=$1, description=$2, completed=$3, due_date=$4, pdf_url=$5, audio_url=$6, transcription=$7, drive_pdf_id=$8, drive_audio_id=$9, slide_tracking=$10, predecessors=$11, assignees=$12, reminder_time=$13, reminder_frequency=$14 WHERE id=$15`, 
            [title, description || null, completed, dueDate || null, pdf_url || null, audio_url || null, transcription || null, drive_pdf_id || null, drive_audio_id || null, slide_tracking || null, JSON.stringify(predecessors || []), JSON.stringify(assignees || []), reminderTime || null, reminderFrequency || null, req.params.id]);
        io.emit('workspace-update'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
server.listen(PORT, () => console.log(`[v31.1 Architecture] Server Running. Port: ${PORT}`));
"""

files["index.html"] = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Manifest v31.1</title>
    <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css">
    <script src="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.js"></script>
    <script src="https://unpkg.com/perfect-freehand"></script>
    <script src="https://unpkg.com/panzoom@9.4.0/dist/panzoom.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/fabric.js/5.3.1/fabric.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
"""

files["src/main.js"] = """import App from './App.svelte';
const app = new App({ target: document.getElementById('app') });
export default app;
"""

files["src/App.svelte"] = """<script>
    import { onMount } from 'svelte';
    import { io } from 'socket.io-client';

    import './components/ManifestNavigationHeader.js';
    import './components/ManifestTaskInputBar.js';
    import './components/ManifestTaskList.js';
    import './components/ManifestCalendarView.js';
    import './components/ManifestAgendaTimeline.js';
    import './components/ManifestGanttView.js';
    import './components/ManifestTaskModalWrapper.js';
    import './components/ManifestApiKeyManager.js';
    import './components/ManifestStudyWorkspace.js';

    let user = null; let tasks = []; let allUsers = [];
    let currentView = 'list'; let editingTask = null; let isStudyMode = false; let apiKeys = [];

    onMount(async () => {
        await checkUser();
        if (user) {
            await Promise.all([loadTasks(), loadUsers()]);
            const socket = io();
            socket.on('workspace-update', async () => await loadTasks());
        }
    });

    async function checkUser() { const res = await fetch('/api/user'); if (res.ok) user = await res.json(); }
    async function loadTasks() { const res = await fetch('/api/tasks'); if (res.ok) tasks = await res.json(); }
    async function loadUsers() { const res = await fetch('/api/users'); if (res.ok) allUsers = await res.json(); }
    async function fetchApiKeys() { const res = await fetch('/api/settings/keys'); if (res.ok) apiKeys = await res.json(); }

    function handleViewChange(e) { currentView = e.detail.view; if (currentView === 'settings' && user) fetchApiKeys(); }

    function handleAddTask(e) { fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: e.detail.title }) }).then(() => loadTasks()); }

    function handleToggleComplete(e) {
        const task = e.detail.task; task.completed = !task.completed;
        let p = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : (task.predecessors || []);
        let a = typeof task.assignees === 'string' ? JSON.parse(task.assignees) : (task.assignees || []);
        fetch(`/api/tasks/${task.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...task, predecessors: p, assignees: a}) }).then(() => loadTasks());
    }

    function handleSaveTask(e) { const t = e.detail.task; fetch(`/api/tasks/${t.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }).then(() => loadTasks()); }
</script>

<main>
    <div class="container {isStudyMode ? 'study-expanded' : ''}">
        <manifest-navigation-header user={user ? JSON.stringify(user) : ''} current-view={currentView} is-study-mode={isStudyMode} on:view-change={handleViewChange} on:logout={() => window.location.href='/auth/logout'}></manifest-navigation-header>

        {#if !user}
            <div class="login-box"><p>Drive access configuration is mandatory to load assets.</p><a href="/auth/google" class="btn google-btn">Login with Google</a></div>
        {:else if !isStudyMode && !editingTask}
            {#if currentView === 'list'}
                <manifest-task-input-bar on:add-task={handleAddTask}></manifest-task-input-bar>
                <manifest-task-list .tasks={tasks} on:toggle-complete={handleToggleComplete} on:open-edit={(e) => { editingTask = e.detail.task; }}></manifest-task-list>
            {:else if currentView === 'calendar'} <manifest-calendar-view .tasks={tasks} on:open-edit={(e) => editingTask = e.detail.task}></manifest-calendar-view>
            {:else if currentView === 'agenda'} <manifest-agenda-timeline .tasks={tasks} on:open-edit={(e) => editingTask = e.detail.task}></manifest-agenda-timeline>
            {:else if currentView === 'gantt'} <manifest-gantt-view .tasks={tasks}></manifest-gantt-view>
            {:else if currentView === 'settings'} <manifest-api-key-manager .keys={apiKeys} .user={user}></manifest-api-key-manager>
            {/if}
        {:else if isStudyMode && editingTask}
            <manifest-study-workspace .task={editingTask} on:close-study={() => { isStudyMode = false; loadTasks(); }} on:save-task={handleSaveTask}></manifest-study-workspace>
        {:else if editingTask}
            <manifest-task-modal-wrapper .task={editingTask} .allTasks={tasks} .allUsers={allUsers} on:close-modal={() => { editingTask = null; loadTasks(); }} on:save-task={handleSaveTask} on:open-study={() => isStudyMode = true}></manifest-task-modal-wrapper>
        {/if}
    </div>
</main>

<style>
    :global(body) { background: #0c0c0c; color: #e2e8f0; font-family: system-ui, sans-serif; margin: 0; padding: 0; }
    main { padding: 20px; display: flex; justify-content: center; }
    .container { width: 100%; max-width: 900px; background: #141414; padding: 25px; border-radius: 10px; border: 1px solid #222; }
    .study-expanded { max-width: 1500px; height: 95vh; display: flex; flex-direction: column; overflow: hidden; }
    .login-box { text-align: center; padding: 40px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; }
    .google-btn { display: inline-block; background: #4285f4; color: white; text-decoration: none; padding: 10px 20px; border-radius: 4px; font-weight: 500; margin-top: 15px; }
</style>
"""

# Web Components
files["src/components/ManifestNavigationHeader.js"] = """
class ManifestNavigationHeader extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #232323; padding-bottom: 15px; margin-bottom: 20px; }
            .header.collapsed { padding-bottom: 5px; margin-bottom: 10px; }
            h1 { margin: 0; font-size: 1.5rem; color: #fff; } h1 span { color: #777; font-weight: normal; font-size: 1.2rem; }
            .logout-btn, .collapse-btn { background: #333; color: #ccc; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight: bold; }
            .view-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 1px solid #222; padding-bottom: 12px; }
            .view-tabs button { background: none; border: none; color: #777; padding: 8px 16px; cursor: pointer; font-weight: 600; }
            .view-tabs button.active { background: #222; color: #fff; border-radius: 4px; }
          </style>
          <div class="header" id="header">
            <h1>Manifest <span id="version">- v31.1 Architecture</span></h1>
            <div style="display:flex; gap:10px;"><button class="collapse-btn" id="collapseBtn" style="display:none; padding:4px 8px; font-size:0.75rem;">⛶ Expand</button><button class="logout-btn" id="logoutBtn" style="display:none;">Logout</button></div>
          </div>
          <div class="view-tabs" id="tabsContainer" style="display: none;">
            <button data-view="list">Task List</button> <button data-view="calendar">Calendar</button> <button data-view="agenda">Agenda</button> <button data-view="gantt">Gantt</button> <button data-view="settings">Settings</button>
          </div>
        `;
        this.isCollapsed = false;
    }
    static get observedAttributes() { return ['current-view', 'user', 'is-study-mode']; }
    attributeChangedCallback(name, old, newVal) {
        if (name === 'current-view') this.updateTabs(newVal);
        if (name === 'user') this.updateUser(newVal);
        if (name === 'is-study-mode') this.updateStudyMode(newVal === 'true');
    }
    connectedCallback() {
        this.shadowRoot.getElementById('logoutBtn').addEventListener('click', () => this.dispatchEvent(new CustomEvent('logout', { bubbles: true, composed: true })));
        this.shadowRoot.getElementById('tabsContainer').addEventListener('click', (e) => { if (e.target.tagName === 'BUTTON') this.dispatchEvent(new CustomEvent('view-change', { detail: { view: e.target.dataset.view }, bubbles: true, composed: true })); });
        this.shadowRoot.getElementById('collapseBtn').addEventListener('click', () => { this.isCollapsed = !this.isCollapsed; this.shadowRoot.getElementById('header').classList.toggle('collapsed', this.isCollapsed); this.shadowRoot.getElementById('collapseBtn').textContent = this.isCollapsed ? '⛶ Expand' : '🗕 Collapse'; });
    }
    updateTabs(activeView) { this.shadowRoot.querySelectorAll('.view-tabs button').forEach(btn => btn.classList.toggle('active', btn.dataset.view === activeView)); }
    updateUser(userStr) { const hasUser = !!userStr; this.shadowRoot.getElementById('logoutBtn').style.display = hasUser ? 'block' : 'none'; if (this.getAttribute('is-study-mode') !== 'true') this.shadowRoot.getElementById('tabsContainer').style.display = hasUser ? 'flex' : 'none'; }
    updateStudyMode(isStudy) { this.shadowRoot.getElementById('tabsContainer').style.display = isStudy ? 'none' : 'flex'; this.shadowRoot.getElementById('collapseBtn').style.display = isStudy ? 'block' : 'none'; if(isStudy) { this.isCollapsed = true; this.shadowRoot.getElementById('header').classList.add('collapsed'); this.shadowRoot.getElementById('version').style.display = 'none'; } else { this.isCollapsed = false; this.shadowRoot.getElementById('header').classList.remove('collapsed'); this.shadowRoot.getElementById('version').style.display = 'inline'; } }
}
customElements.define('manifest-navigation-header', ManifestNavigationHeader);
"""

files["src/components/ManifestTaskInputBar.js"] = """
class ManifestTaskInputBar extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>.task-input { display: flex; gap: 10px; margin-bottom: 20px; } input { flex: 1; padding: 10px; background: #1a1a1a; border: 1px solid #333; color: white; border-radius: 4px; } button { background: #646cff; color: white; border: none; padding: 0 20px; font-size: 1.5rem; border-radius: 4px; cursor: pointer;}</style>
          <div class="task-input"><input type="text" id="taskTitle" placeholder="New task..." /><button id="addBtn">+</button></div>
        `;
    }
    connectedCallback() {
        const input = this.shadowRoot.getElementById('taskTitle');
        const submit = () => { if (!input.value.trim()) return; this.dispatchEvent(new CustomEvent('add-task', { detail: { title: input.value }, bubbles: true, composed: true })); input.value = ''; };
        this.shadowRoot.getElementById('addBtn').addEventListener('click', submit);
        input.addEventListener('keydown', (e) => { if(e.key === 'Enter') submit(); });
    }
}
customElements.define('manifest-task-input-bar', ManifestTaskInputBar);
"""

files["src/components/ManifestTaskList.js"] = """
class ManifestTaskList extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .task-list { list-style: none; padding: 0; margin: 0; }
            .task-item { display: flex; align-items: center; gap: 15px; background: #1a1a1a; padding: 15px; margin-bottom: 10px; border-radius: 6px; border: 1px solid #222; cursor: pointer; }
            .task-item.blocked { opacity: 0.5; }
            .badge { background: #555; color: #ddd; font-size: 0.75rem; padding: 3px 8px; border-radius: 12px; margin-left:10px; }
            .badge.warning { background: #8a6a00; font-weight: bold; }
            input[type="checkbox"] { width: 18px; height: 18px; cursor: pointer; accent-color: #646cff; }
            .task-content { flex: 1; color: #eee; }
          </style>
          <ul class="task-list" id="list"></ul>
        `;
    }
    set tasks(value) { this._tasks = value || []; this.render(); }
    isBlocked(task) {
        if (!task.predecessors || task.predecessors.length === 0) return false;
        let parsed = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : task.predecessors;
        return parsed.some(pid => { const p = this._tasks.find(t => t.id === pid); return p && !p.completed; });
    }
    render() {
        const container = this.shadowRoot.getElementById('list'); container.innerHTML = '';
        this._tasks.filter(t => !t.completed).forEach(task => {
            const blocked = this.isBlocked(task);
            const li = document.createElement('li'); li.className = `task-item ${blocked ? 'blocked' : ''}`;
            const chk = document.createElement('input'); chk.type = 'checkbox'; chk.checked = task.completed; chk.disabled = blocked;
            chk.addEventListener('change', () => this.dispatchEvent(new CustomEvent('toggle-complete', { detail: { task }, bubbles: true, composed: true })));
            const content = document.createElement('div'); content.className = 'task-content';
            content.innerHTML = `<span>${task.title}</span> ${blocked ? '<span class="badge warning">🔒 Blocked</span>' : ''}`;
            content.addEventListener('click', () => this.dispatchEvent(new CustomEvent('open-edit', { detail: { task }, bubbles: true, composed: true })));
            li.appendChild(chk); li.appendChild(content); container.appendChild(li);
        });
    }
}
customElements.define('manifest-task-list', ManifestTaskList);
"""

files["src/components/ManifestCalendarView.js"] = """
class ManifestCalendarView extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .cal-controls { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; color:white;}
            .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
            .cal-header-cell { text-align: center; font-weight: bold; color: #888; padding-bottom: 10px; }
            .cal-cell { background: #1a1a1a; min-height: 80px; padding: 5px; border-radius: 4px; display: flex; flex-direction: column;}
            .cal-cell.empty { background: transparent; }
            .day-num { text-align: right; color: #666; font-size: 0.8rem; margin-bottom: 5px;}
            .mini-task { background: #646cff; color: white; font-size: 0.7rem; padding: 3px 5px; border-radius: 2px; margin-bottom: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
            button { background: #333; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer; }
          </style>
          <div class="cal-controls"><button id="prevBtn">◀ Prev</button><h3 id="calTitle">Month View</h3><button id="nextBtn">Next ▶</button></div>
          <div class="cal-grid" id="grid"></div>
        `;
        this.currentDate = new Date();
    }
    set tasks(value) { this._tasks = value || []; this.render(); }
    connectedCallback() {
        this.shadowRoot.getElementById('prevBtn').addEventListener('click', () => { this.currentDate.setMonth(this.currentDate.getMonth() - 1); this.render(); });
        this.shadowRoot.getElementById('nextBtn').addEventListener('click', () => { this.currentDate.setMonth(this.currentDate.getMonth() + 1); this.render(); });
    }
    render() {
        const year = this.currentDate.getFullYear(); const month = this.currentDate.getMonth();
        this.shadowRoot.getElementById('calTitle').textContent = this.currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
        const grid = this.shadowRoot.getElementById('grid'); grid.innerHTML = '';
        ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(day => { grid.innerHTML += `<div class="cal-header-cell">${day}</div>`; });
        const firstDay = new Date(year, month, 1).getDay(); const daysInMonth = new Date(year, month + 1, 0).getDate();
        for (let i = 0; i < firstDay; i++) { grid.innerHTML += `<div class="cal-cell empty"></div>`; }
        for (let i = 1; i <= daysInMonth; i++) {
            const cell = document.createElement('div'); cell.className = 'cal-cell'; cell.innerHTML = `<div class="day-num">${i}</div>`;
            this._tasks.forEach(t => {
                if(!t.completed && t.due_date && new Date(t.due_date).getDate() === i && new Date(t.due_date).getMonth() === month) {
                    const mt = document.createElement('div'); mt.className = 'mini-task'; mt.textContent = t.title;
                    mt.addEventListener('click', () => this.dispatchEvent(new CustomEvent('open-edit', { detail: { task: t }, bubbles: true, composed: true })));
                    cell.appendChild(mt);
                }
            });
            grid.appendChild(cell);
        }
    }
}
customElements.define('manifest-calendar-view', ManifestCalendarView);
"""

files["src/components/ManifestAgendaTimeline.js"] = """
class ManifestAgendaTimeline extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .agenda-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
            .agenda-item { display: flex; align-items: center; background: #111; border: 1px solid #222; padding: 12px; margin-bottom: 10px; border-radius: 6px; border-left: 4px solid #646cff; cursor: pointer;}
            .agenda-date { min-width: 80px; display: flex; flex-direction: column; align-items: center; padding-right: 15px; border-right: 1px solid #333; margin-right: 15px; }
            .agenda-date .date { font-size: 1.1rem; font-weight: bold; color: #eee; }
            .task-title { color: white; }
          </style>
          <div class="agenda-view"><h2 style="color:white; margin-top:0;">Agenda Timeline</h2><div id="container"></div></div>
        `;
    }
    set tasks(value) {
        const container = this.shadowRoot.getElementById('container'); container.innerHTML = '';
        let active = (value || []).filter(t => !t.completed);
        active.sort((a, b) => { if (!a.due_date && !b.due_date) return 0; if (!a.due_date) return 1; if (!b.due_date) return -1; return new Date(a.due_date) - new Date(b.due_date); });
        if(active.length === 0) { container.innerHTML = '<p style="color:#666; font-style:italic;">No tasks on the agenda.</p>'; return; }
        active.forEach(t => {
            const row = document.createElement('div'); row.className = 'agenda-item';
            let dateHtml = t.due_date ? `<span class="date">${new Date(t.due_date).toLocaleDateString('en-US', {month:'short', day:'numeric', timeZone:'UTC'})}</span>` : `<span style="color:#555;font-weight:bold;">Anytime</span>`;
            row.innerHTML = `<div class="agenda-date">${dateHtml}</div><div class="task-title">${t.title}</div>`;
            row.addEventListener('click', () => this.dispatchEvent(new CustomEvent('open-edit', { detail: { task: t }, bubbles: true, composed: true })));
            container.appendChild(row);
        });
    }
}
customElements.define('manifest-agenda-timeline', ManifestAgendaTimeline);
"""

files["src/components/ManifestGanttView.js"] = """
class ManifestGanttView extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .gantt-view { background: #1a1a1a; padding: 20px; border-radius: 8px; }
            .gantt-row { display: flex; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #222; padding-bottom: 10px; }
            .gantt-row.blocked .gantt-bar { background: #8a6a00; opacity: 0.5; }
            .gantt-label { width: 150px; font-weight: bold; color: white; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;}
            .gantt-bar { height: 20px; background: #646cff; border-radius: 10px; width: 60%; }
          </style>
          <div class="gantt-view"><h2 style="color:white; margin-top:0;">Project Timeline</h2><div id="container"></div></div>
        `;
    }
    set tasks(value) {
        const container = this.shadowRoot.getElementById('container'); container.innerHTML = '';
        let active = (value || []).filter(t => !t.completed);
        if(active.length === 0) { container.innerHTML = '<p style="color:#666;">No tasks to map.</p>'; return; }
        active.forEach(task => {
            let p = typeof task.predecessors === 'string' ? JSON.parse(task.predecessors) : (task.predecessors || []);
            let blocked = p.some(pid => { const pd = value.find(t=>t.id===pid); return pd && !pd.completed; });
            const row = document.createElement('div'); row.className = `gantt-row ${blocked ? 'blocked' : ''}`;
            row.innerHTML = `<div class="gantt-label" title="${task.title}">${blocked ? '🔒 ' : ''}${task.title}</div><div class="gantt-bar"></div>`;
            container.appendChild(row);
        });
    }
}
customElements.define('manifest-gantt-view', ManifestGanttView);
"""

files["src/components/ManifestApiKeyManager.js"] = """
class ManifestApiKeyManager extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .card { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #222; margin-bottom: 20px; color: white;}
            .btn { background: #646cff; color: white; border: none; padding: 10px 15px; border-radius: 6px; cursor: pointer; font-weight:bold;}
            input { padding:10px; background:#111; border:1px solid #333; color:white; border-radius:4px; flex:1; }
            ul { list-style: none; padding:0;}
            li { background: #111; padding: 10px; margin-bottom: 5px; border-radius: 4px; border: 1px solid #222; }
          </style>
          <div class="card"><h2 style="margin-top:0;">Account & Billing</h2><p>Plan: <strong id="planType">FREE</strong></p><button class="btn" id="upgradeBtn">Upgrade to Pro</button></div>
          <div class="card"><h2>API Integrations</h2><div style="display:flex; gap:10px;"><input type="text" id="keyName" placeholder="Key description..." /><button class="btn" id="genBtn">Generate</button></div><ul id="keyList"></ul></div>
        `;
    }
    set user(val) { if(val) { this.shadowRoot.getElementById('planType').textContent = val.plan_type ? val.plan_type.toUpperCase() : 'FREE'; if (val.plan_type === 'pro') this.shadowRoot.getElementById('upgradeBtn').style.display = 'none'; } }
    set keys(val) {
        const list = this.shadowRoot.getElementById('keyList'); list.innerHTML = '';
        (val || []).forEach(k => { const li = document.createElement('li'); li.textContent = `${k.key_name} - ${new Date(k.created_at).toLocaleDateString()}`; list.appendChild(li); });
    }
    connectedCallback() {
        this.shadowRoot.getElementById('upgradeBtn').addEventListener('click', () => this.dispatchEvent(new CustomEvent('checkout', {bubbles:true, composed:true})));
        this.shadowRoot.getElementById('genBtn').addEventListener('click', () => {
            const input = this.shadowRoot.getElementById('keyName');
            if(input.value) { fetch('/api/settings/keys', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({keyName:input.value})}).then(()=> { input.value = ''; this.dispatchEvent(new CustomEvent('view-change', {detail:{view:'settings'}, bubbles:true, composed:true})); }); }
        });
    }
}
customElements.define('manifest-api-key-manager', ManifestApiKeyManager);
"""

files["src/components/ManifestTaskModalWrapper.js"] = """
class ManifestTaskModalWrapper extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            .modal-overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 100; overflow-y: auto;}
            .modal { background: #1a1a1a; padding: 25px; border-radius: 8px; width: 450px; border: 1px solid #333; margin: auto; display:flex; flex-direction:column; gap:15px;}
            h2 { margin: 0; color: #fff; font-size: 1.3rem; }
            input, select { padding: 10px; background: #111; border: 1px solid #333; color: white; border-radius: 4px; width:100%; box-sizing:border-box;}
            .btn { background: #444; color: white; border: none; padding: 8px 14px; border-radius: 6px; cursor: pointer; font-weight:bold;}
            .btn.primary { background: #646cff; }
            .modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px; }
            .study-banner { background: #1f1f3a; padding: 15px; border-radius: 6px; border: 1px solid #2a2a5a; text-align: center; color:white; margin-top:10px;}
            .section { background: #111; padding: 12px; border-radius: 6px; border: 1px solid #222; }
            .badge { background: #333; border: 1px solid #555; padding: 5px 10px; border-radius: 6px; font-size: 0.85rem; color: #ddd; display:inline-block; margin:5px;}
            .remove-btn { background:transparent; border:none; color:#ff5555; cursor:pointer;}
          </style>
          <div class="modal-overlay">
            <div class="modal">
                <h2>Edit Task</h2>
                <input type="text" id="tTitle" />
                <div style="display:flex; gap:10px; align-items:center;"><label style="color:#aaa;">Due:</label><input type="date" id="tDate" /></div>
                <div class="section"><label style="color:#aaa;">Reminders:</label><input type="time" id="tTime" style="margin-bottom:5px;" /><select id="tFreq"><option value="daily">Every Day</option><option value="weekdays">Every Weekday</option><option value="weekends">Every Weekend</option></select></div>
                <div class="section"><label style="color:#aaa;">Assignees:</label><div id="assignBadgeArea"></div><div style="display:flex; gap:5px; margin-top:5px;"><select id="userSel"><option value="">-- Add User --</option></select><button class="btn" id="addAssignBtn">Add</button></div></div>
                <div class="section"><label style="color:#aaa;">Depends On:</label><div id="depBadgeArea"></div><div style="display:flex; gap:5px; margin-top:5px;"><select id="depSel"><option value="">-- Add Predecessor --</option></select><button class="btn" id="addDepBtn">Add</button></div></div>
                <div class="study-banner"><button class="btn primary" style="width:100%;" id="studyBtn">📚 Open Study Mode (PDF & Audio)</button></div>
                <div class="modal-actions"><button class="btn" id="cancelBtn">Cancel</button><button class="btn primary" id="saveBtn">Save</button></div>
            </div>
          </div>
        `;
    }

    set allUsers(val) { this._allUsers = val || []; this.populateDropdowns(); }
    set allTasks(val) { this._allTasks = val || []; this.populateDropdowns(); }
    set task(val) {
        this._task = JSON.parse(JSON.stringify(val)); 
        if(typeof this._task.predecessors === 'string') this._task.predecessors = JSON.parse(this._task.predecessors || '[]');
        if(typeof this._task.assignees === 'string') this._task.assignees = JSON.parse(this._task.assignees || '[]');
        this._task.predecessors = this._task.predecessors || [];
        this._task.assignees = this._task.assignees || [];
        this.shadowRoot.getElementById('tTitle').value = this._task.title;
        this.shadowRoot.getElementById('tDate').value = this._task.due_date ? this._task.due_date.split('T')[0] : '';
        this.shadowRoot.getElementById('tTime').value = this._task.reminder_time || '';
        this.shadowRoot.getElementById('tFreq').value = this._task.reminder_frequency || 'daily';
        this.renderBadges(); this.populateDropdowns();
    }

    populateDropdowns() {
        if(!this._task) return;
        const uSel = this.shadowRoot.getElementById('userSel'); uSel.innerHTML = '<option value="">-- Add User --</option>';
        (this._allUsers || []).filter(u => !this._task.assignees.includes(u.id) && u.id !== this._task.user_id).forEach(u => uSel.innerHTML += `<option value="${u.id}">${u.username}</option>`);
        const dSel = this.shadowRoot.getElementById('depSel'); dSel.innerHTML = '<option value="">-- Add Predecessor --</option>';
        (this._allTasks || []).filter(t => t.id !== this._task.id && !this._task.predecessors.includes(t.id)).forEach(t => dSel.innerHTML += `<option value="${t.id}">${t.title}</option>`);
    }

    renderBadges() {
        const aArea = this.shadowRoot.getElementById('assignBadgeArea'); aArea.innerHTML = '';
        this._task.assignees.forEach(uid => { const u = (this._allUsers||[]).find(x=>x.id===uid); const b = document.createElement('span'); b.className='badge'; b.innerHTML = `${u?u.username:'User'} <button class="remove-btn" data-type="assign" data-id="${uid}">x</button>`; aArea.appendChild(b); });
        const dArea = this.shadowRoot.getElementById('depBadgeArea'); dArea.innerHTML = '';
        this._task.predecessors.forEach(pid => { const t = (this._allTasks||[]).find(x=>x.id===pid); const b = document.createElement('span'); b.className='badge'; b.innerHTML = `${t?t.title:'Task'} <button class="remove-btn" data-type="dep" data-id="${pid}">x</button>`; dArea.appendChild(b); });
        this.shadowRoot.querySelectorAll('.remove-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = parseInt(e.target.dataset.id);
                if(e.target.dataset.type==='assign') this._task.assignees = this._task.assignees.filter(x=>x!==id);
                if(e.target.dataset.type==='dep') this._task.predecessors = this._task.predecessors.filter(x=>x!==id);
                this.renderBadges(); this.populateDropdowns();
            });
        });
    }

    connectedCallback() {
        this.shadowRoot.getElementById('addAssignBtn').addEventListener('click', () => { const v = parseInt(this.shadowRoot.getElementById('userSel').value); if(v) { this._task.assignees.push(v); this.renderBadges(); this.populateDropdowns(); } });
        this.shadowRoot.getElementById('addDepBtn').addEventListener('click', () => { const v = parseInt(this.shadowRoot.getElementById('depSel').value); if(v) { this._task.predecessors.push(v); this.renderBadges(); this.populateDropdowns(); } });
        this.shadowRoot.getElementById('cancelBtn').addEventListener('click', () => this.dispatchEvent(new CustomEvent('close-modal', {bubbles:true, composed:true})));
        this.shadowRoot.getElementById('studyBtn').addEventListener('click', () => { this.saveData(); this.dispatchEvent(new CustomEvent('open-study', {bubbles:true, composed:true})); });
        this.shadowRoot.getElementById('saveBtn').addEventListener('click', () => { this.saveData(); this.dispatchEvent(new CustomEvent('close-modal', {bubbles:true, composed:true})); });
    }

    saveData() {
        this._task.title = this.shadowRoot.getElementById('tTitle').value;
        this._task.dueDate = this.shadowRoot.getElementById('tDate').value;
        this._task.reminderTime = this.shadowRoot.getElementById('tTime').value;
        this._task.reminderFrequency = this.shadowRoot.getElementById('tFreq').value;
        this.dispatchEvent(new CustomEvent('save-task', {detail:{task: this._task}, bubbles:true, composed:true}));
    }
}
customElements.define('manifest-task-modal-wrapper', ManifestTaskModalWrapper);
"""

files["src/components/ManifestStudyWorkspace.js"] = """
class ManifestStudyWorkspace extends HTMLElement {
    constructor() {
        super(); this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `
          <style>
            :host { display: block; height: calc(100vh - 100px); }
            .study-layout { display: flex; gap: 20px; height: 100%; }
            .sidebar { width: 280px; display: flex; flex-direction: column; background: #161616; border: 1px solid #333; border-radius: 8px; padding: 15px; }
            .main-workspace { flex: 1; display: flex; flex-direction: column; gap: 15px; overflow: hidden; }
            .pdf-panel { flex: 3; display: flex; flex-direction: column; background: #080808; border-radius: 8px; border: 1px solid #333; overflow: hidden; }
            .notes-panel { flex: 2; display: flex; flex-direction: column; background: #161616; padding: 15px; border-radius: 8px; border: 1px solid #333; }
            .btn { background: #3f3f5a; color: white; border: none; padding: 8px 14px; border-radius: 4px; cursor: pointer; font-weight: bold; }
            .btn.primary { background: #646cff; }
            .btn.danger { background: #e11d48; }
            .canvas-container { flex: 1; overflow: hidden; display: flex; justify-content: center; align-items: center; padding: 15px; background: #111; cursor: grab; position:relative;}
            .canvas-container:active { cursor: grabbing; }
            #zoom-wrapper { position: relative; transform-origin: 0 0; }
            .pdf-base-layer { display: block; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.8); }
            .drawing-layer { position: absolute; top: 0; left: 0; touch-action: none; z-index: 10; }
            .svg-layer { z-index: 11; }
            .fabric-layer { z-index: 12; }
            textarea { flex: 1; background: #111; color: white; border: 1px solid #333; padding: 15px; border-radius: 6px; font-family: monospace; resize: none; }
            .markdown-body { flex: 1; padding: 15px; background: #111; border-radius: 6px; border: 1px solid #333; overflow-y: auto; color:#eee;}
          </style>
          <div style="display:flex; justify-content:space-between; margin-bottom:10px;"><h2 id="wsTitle" style="color:white; margin:0;">Document</h2><button class="btn" id="closeStudyBtn">Exit Study Mode</button></div>
          <div class="study-layout">
            <div class="sidebar">
                <div style="color:#aaa; margin-bottom:10px; font-weight:bold;">AUDIO & TRANSCRIPT</div>
                <button class="btn danger" id="recBtn">🔴 Record</button>
                <audio id="audioPlayer" controls style="width:100%; margin-top:10px; display:none;"></audio>
                <textarea id="transcript" style="margin-top:10px;" placeholder="Live transcription..."></textarea>
            </div>
            <div class="main-workspace">
                <div class="pdf-panel">
                    <div style="padding:10px; background:#161616; border-bottom:1px solid #333; display:flex; justify-content:space-between; align-items:center;">
                        <div><label class="btn primary" style="cursor:pointer;">Upload PDF<input type="file" id="pdfUpload" accept="application/pdf" style="display:none;" /></label><span id="pageInfo" style="color:white; margin-left:10px;"></span></div>
                        <div style="display:flex; gap:10px;">
                            <select id="drawMode" style="background:#222; color:white; border:1px solid #444; padding:6px; border-radius:4px;"><option value="off">Mode: Read-Only</option><option value="svg">Mode: Perfect Freehand</option><option value="fabric">Mode: Fabric.js</option></select>
                            <button class="btn" id="panBtn">🖐 Pan</button><button class="btn" id="drawBtn">✏️ Draw</button><button class="btn" id="clearBtn">🗑️ Clear</button>
                        </div>
                    </div>
                    <div class="canvas-container" id="containerRef">
                        <div id="zoom-wrapper">
                            <canvas id="pdfCanvas" class="pdf-base-layer"></canvas>
                            <svg id="drawingSvg" class="drawing-layer svg-layer"></svg>
                            <div id="fabWrapper" class="drawing-layer fabric-layer" style="display:none;"><canvas id="fabCanvas"></canvas></div>
                        </div>
                    </div>
                </div>
                <div class="notes-panel">
                    <div style="color:#aaa; margin-bottom:10px; font-weight:bold;">LATEX / MARKDOWN NOTES</div>
                    <div style="display:flex; gap:15px; flex:1; min-height:0;"><textarea id="mdInput" placeholder="Markdown..."></textarea><div id="mdPreview" class="markdown-body"></div></div>
                </div>
            </div>
          </div>
        `;
        this.pdfDoc = null; this.pageNum = 1; this.pdfWidth = 0; this.pdfHeight = 0; this.drawingMode = 'off'; this.isPanning = true; this.pzInstance = null; this.fabCanvas = null; this.strokes = []; this.currentPoints = []; this.isRecording = false; this.mediaRecorder = null; this.audioChunks = []; this.recognition = null;
    }

    set task(val) {
        this._task = val; this.shadowRoot.getElementById('wsTitle').textContent = val.title;
        const md = this.shadowRoot.getElementById('mdInput'); md.value = val.description || ''; this.renderMarkdown();
        if (val.pdf_url) this.loadPdf(val.pdf_url);
        if (val.audio_url) { const aud = this.shadowRoot.getElementById('audioPlayer'); aud.src = val.audio_url; aud.style.display = 'block'; }
        if (val.transcription) this.shadowRoot.getElementById('transcript').value = val.transcription;
    }

    connectedCallback() {
        this.shadowRoot.getElementById('closeStudyBtn').addEventListener('click', () => this.dispatchEvent(new CustomEvent('close-study', {bubbles:true, composed:true})));
        this.shadowRoot.getElementById('mdInput').addEventListener('input', () => { this._task.description = this.shadowRoot.getElementById('mdInput').value; this.renderMarkdown(); this.saveTask(); });
        this.shadowRoot.getElementById('transcript').addEventListener('input', () => { this._task.transcription = this.shadowRoot.getElementById('transcript').value; this.saveTask(); });
        this.shadowRoot.getElementById('pdfUpload').addEventListener('change', (e) => this.handleUpload(e.target.files[0], 'pdf'));
        this.shadowRoot.getElementById('drawMode').addEventListener('change', (e) => { this.drawingMode = e.target.value; this.isPanning = this.drawingMode === 'off'; this.updateDrawState(); });
        this.shadowRoot.getElementById('panBtn').addEventListener('click', () => { this.isPanning = true; this.updateDrawState(); });
        this.shadowRoot.getElementById('drawBtn').addEventListener('click', () => { this.isPanning = false; this.updateDrawState(); });
        this.shadowRoot.getElementById('clearBtn').addEventListener('click', () => { this.strokes = []; this.renderSvg(); if(this.fabCanvas) this.fabCanvas.clear(); });
        this.shadowRoot.getElementById('recBtn').addEventListener('click', () => this.toggleRecording());

        const svg = this.shadowRoot.getElementById('drawingSvg');
        svg.addEventListener('pointerdown', (e) => { if(this.isPanning || this.drawingMode !== 'svg') return; e.currentTarget.setPointerCapture(e.pointerId); this.currentPoints = [[e.offsetX, e.offsetY, e.pressure !== undefined ? e.pressure : 0.5]]; });
        svg.addEventListener('pointermove', (e) => { if(this.isPanning || this.drawingMode !== 'svg' || this.currentPoints.length===0) return; this.currentPoints = [...this.currentPoints, [e.offsetX, e.offsetY, e.pressure !== undefined ? e.pressure : 0.5]]; this.renderSvg(); });
        svg.addEventListener('pointerup', (e) => { if(this.isPanning || this.drawingMode !== 'svg' || this.currentPoints.length===0) return; this.strokes = [...this.strokes, this.currentPoints]; this.currentPoints = []; this.renderSvg(); });
        this.initSpeech();
    }

    renderMarkdown() {
        const raw = this.shadowRoot.getElementById('mdInput').value; const out = this.shadowRoot.getElementById('mdPreview');
        if(window.marked) {
            let parsed = raw.replace(/\\$\\$([\\s\\S]*?)\\$\\$/g, (m, eq) => window.katex ? window.katex.renderToString(eq, {displayMode:true}) : m);
            parsed = parsed.replace(/\\$([^\\$\\n]+?)\\$/g, (m, eq) => window.katex ? window.katex.renderToString(eq, {displayMode:false}) : m);
            out.innerHTML = window.marked.parse(parsed);
        } else { out.textContent = raw; }
    }

    saveTask() { this.dispatchEvent(new CustomEvent('save-task', {detail:{task:this._task}, bubbles:true, composed:true})); }

    async handleUpload(file, type) {
        if(!file) return; const fd = new FormData(); fd.append('file', file);
        const url = URL.createObjectURL(file);
        if(type==='pdf') this.loadPdf(url);
        if(type==='audio') { const aud = this.shadowRoot.getElementById('audioPlayer'); aud.src = url; aud.style.display = 'block'; }
        try {
            const res = await fetch('/api/drive/upload', { method:'POST', body:fd }); const data = await res.json();
            if(data.fileId) {
                if(type==='pdf') { this._task.drive_pdf_id = data.fileId; this._task.pdf_url = `/api/drive/download/${data.fileId}`; }
                if(type==='audio') { this._task.drive_audio_id = data.fileId; this._task.audio_url = `/api/drive/download/${data.fileId}`; }
                this.saveTask();
            }
        } catch(e) { console.error("Upload failed", e); }
    }

    async loadPdf(url) { if(!window.pdfjsLib) return; try { this.pdfDoc = await window.pdfjsLib.getDocument(url).promise; this.renderPage(1); } catch(e) { console.error(e); } }

    async renderPage(num) {
        if(!this.pdfDoc) return; this.pageNum = num; this.shadowRoot.getElementById('pageInfo').textContent = `Page ${num}/${this.pdfDoc.numPages}`;
        const page = await this.pdfDoc.getPage(num); const viewport = page.getViewport({ scale: 1.5 });
        const canvas = this.shadowRoot.getElementById('pdfCanvas'); const ctx = canvas.getContext('2d');
        canvas.width = viewport.width; canvas.height = viewport.height; this.pdfWidth = viewport.width; this.pdfHeight = viewport.height;
        const svg = this.shadowRoot.getElementById('drawingSvg'); svg.style.width = viewport.width + 'px'; svg.style.height = viewport.height + 'px';
        await page.render({ canvasContext: ctx, viewport: viewport }).promise;
        if(!this.pzInstance && window.panzoom) { this.pzInstance = window.panzoom(this.shadowRoot.getElementById('zoom-wrapper'), { bounds: true, boundsPadding: 0.1, maxZoom: 5, minZoom: 0.5 }); }
        this.updateDrawState();
    }

    updateDrawState() {
        if(this.pzInstance) { if(this.isPanning) this.pzInstance.resume(); else this.pzInstance.pause(); }
        const svg = this.shadowRoot.getElementById('drawingSvg'); const fab = this.shadowRoot.getElementById('fabWrapper');
        svg.style.pointerEvents = (this.drawingMode === 'svg' && !this.isPanning) ? 'auto' : 'none';
        if (this.drawingMode === 'fabric') {
            fab.style.display = 'block'; fab.style.pointerEvents = this.isPanning ? 'none' : 'auto';
            if(!this.fabCanvas && window.fabric) {
                const c = this.shadowRoot.getElementById('fabCanvas'); c.width = this.pdfWidth; c.height = this.pdfHeight;
                this.fabCanvas = new window.fabric.Canvas(c, { isDrawingMode: true, width: this.pdfWidth, height: this.pdfHeight });
                this.fabCanvas.freeDrawingBrush.color = '#3b82f6'; this.fabCanvas.freeDrawingBrush.width = 3;
            } else if(this.fabCanvas) { this.fabCanvas.isDrawingMode = !this.isPanning; }
        } else { fab.style.display = 'none'; }
    }

    renderSvg() {
        if(!window.perfectFreehand) return; const svg = this.shadowRoot.getElementById('drawingSvg'); let html = '';
        this.strokes.forEach(s => { html += `<path d="${this.getSvgPath(window.perfectFreehand.getStroke(s, { size:6, thinning:0.5 }))}" fill="#3b82f6" />`; });
        if(this.currentPoints.length > 0) { html += `<path d="${this.getSvgPath(window.perfectFreehand.getStroke(this.currentPoints, { size:6, thinning:0.5 }))}" fill="#3b82f6" />`; }
        svg.innerHTML = html;
    }

    getSvgPath(stroke) {
        if (!stroke.length) return '';
        const d = stroke.reduce((acc, [x0, y0], i, arr) => { const [x1, y1] = arr[(i + 1) % arr.length]; acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2); return acc; }, ['M', ...stroke[0], 'Q']);
        d.push('Z'); return d.join(' ');
    }

    initSpeech() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if(SR) {
            this.recognition = new SR(); this.recognition.continuous = true; this.recognition.interimResults = true;
            this.recognition.onresult = (e) => {
                const ta = this.shadowRoot.getElementById('transcript');
                for(let i = e.resultIndex; i<e.results.length; i++) { if(e.results[i].isFinal) { ta.value += e.results[i][0].transcript + ' '; this._task.transcription = ta.value; this.saveTask(); } }
            };
        }
    }

    async toggleRecording() {
        const btn = this.shadowRoot.getElementById('recBtn');
        if(!this.isRecording) {
            const stream = await navigator.mediaDevices.getUserMedia({audio:true}); this.mediaRecorder = new MediaRecorder(stream); this.audioChunks = [];
            this.mediaRecorder.ondataavailable = e => this.audioChunks.push(e.data);
            this.mediaRecorder.onstop = () => { const blob = new Blob(this.audioChunks, {type:'audio/mp3'}); this.handleUpload(blob, 'audio'); };
            this.mediaRecorder.start(); this.isRecording = true; btn.textContent = '⏹ Stop Recording';
            if(this.recognition) this.recognition.start();
        } else {
            this.mediaRecorder.stop(); this.isRecording = false; btn.textContent = '🔴 Record';
            if(this.recognition) this.recognition.stop();
        }
    }
}
customElements.define('manifest-study-workspace', ManifestStudyWorkspace);
"""

# Compile to build.py file string
build_py_content = """import os
import zipfile
import base64

files = {
"""

for filepath, content in files.items():
    # Safely escape for the string representation
    escaped_content = content.replace('\\\\', '\\\\\\\\').replace('\"', '\\\"').replace('\\n', '\\\\n')
    build_py_content += f'    "{filepath}": "{escaped_content}",\n'

build_py_content += """
}

zip_name = "manifest_v31.1_feature_complete.zip"
with zipfile.ZipFile(zip_name, 'w', zipfile.ZIP_DEFLATED) as zf:
    for path, content in files.items():
        zf.writestr(path, content.strip())

print(f"✅ Successfully created {zip_name} in the current directory.")
"""

# Fixed section: writes the content to an actual python file instead of throwing an error.
with open("build.py", "w", encoding="utf-8") as f:
    f.write(build_py_content)

print("✅ Successfully generated build.py")
