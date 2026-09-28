import express from 'express';
import crypto from 'crypto';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();

/**
 * @swagger
 * /api/settings/keys:
 *   post:
 *     summary: Generate a new API Key for Microsoft Power Automate / Outlook integration
 *     security:
 *       - CookieAuth: []
 *       - ApiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - keyName
 *             properties:
 *               keyName:
 *                 type: string
 *                 example: "Power Automate Flow Key"
 *     responses:
 *       201:
 *         description: Key generated successfully. Returns cleartext API key (only shown once).
 *       500:
 *         description: DB error
 */
router.post('/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { keyName } = req.body;
    try {
        const cleartextKey = 'app_pp_' + crypto.randomBytes(24).toString('hex');
        const secureHash = crypto.createHash('sha256').update(cleartextKey).digest('hex');
        await pool.query('INSERT INTO user_api_keys (user_id, key_name, api_key_hash) VALUES ($1, $2, $3)', [req.user.id, keyName.trim(), secureHash]);
        res.status(201).json({ key: cleartextKey });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

/**
 * @swagger
 * /api/settings/keys:
 *   get:
 *     summary: List all active API Keys for the current user
 *     security:
 *       - CookieAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of API keys
 */
router.get('/keys', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, key_name, created_at FROM user_api_keys WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

/**
 * @swagger
 * /api/settings/keys/{id}:
 *   delete:
 *     summary: Revoke an existing API Key
 *     security:
 *       - CookieAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Key revoked
 */
router.delete('/keys/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        await pool.query('DELETE FROM user_api_keys WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'DB Error' }); }
});

export default router;
