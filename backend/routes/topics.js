import express from 'express';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();

router.get('/', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM topics WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    }
    catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const name = req.body.name ? req.body.name.trim() : '';
        const color = req.body.color ? req.body.color.trim() : '#646cff';
        if (!name) {
            return res.status(400).json({ error: 'Name is required and cannot be empty.' });
        }
        const result = await pool.query('INSERT INTO topics (user_id, name, color) VALUES ($1, $2, $3) RETURNING *', [req.user.id, name, color]);
        req.app.get('io').emit('workspace-update');
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        // nullify topic_id for tasks referencing this topic
        await pool.query('UPDATE tasks SET topic_id = NULL WHERE topic_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        await pool.query('DELETE FROM topics WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        req.app.get('io').emit('workspace-update');
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

export default router;
