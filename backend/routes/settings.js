import express from 'express';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();

router.post('/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { keyName } = req.body;
    try {
        const cleartextKey = 'app_pp_' + crypto.randomBytes(24).toString('hex');
        const secureHash = crypto.createHash('sha256').update(cleartextKey).digest('hex');
        await pool.query('INSERT INTO user_api_keys (user_id, key_name, api_key_hash) VALUES ($1, $2, $3)', [req.user.id, keyName.trim(), secureHash]);
        res.status(201).json({ key: cleartextKey });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

router.get('/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, key_name, created_at FROM user_api_keys WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

router.delete('/keys/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query('DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

export default router;
