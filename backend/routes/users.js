import express from 'express';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();

router.get('/user', (req, res) => res.json(req.user || null));

router.get('/users', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username FROM users');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'Failed fetching users' }); }
});

router.put('/user/timezone', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { timezone } = req.body;
    if (!timezone) return res.status(400).json({ error: "Timezone required" });
    try {
        await pool.query('UPDATE users SET timezone = $1 WHERE id = $2', [timezone, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed to update timezone' }); }
});

export default router;
