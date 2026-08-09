import crypto from 'crypto';
import { pool } from '../db/index.js';

export async function ensureAuthenticatedOrApiKey(req, res, next) {
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
