import express from 'express';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();

// Get all topics for the authenticated user
router.get('/', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM topics WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch topics' });
    }
});

// Create a new topic
router.post('/', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Topic name is required.' });
        }

        const result = await pool.query(
            'INSERT INTO topics (user_id, name, color) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, name.trim(), color || '#646cff']
        );
        req.app.get('io').emit('workspace-update');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to create topic' });
    }
});

// Update an existing topic
router.put('/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ error: 'Topic name is required.' });
        }

        const result = await pool.query(
            'UPDATE topics SET name = $1, color = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
            [name.trim(), color || '#646cff', req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Topic not found or unauthorized' });
        }

        req.app.get('io').emit('workspace-update');
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: 'Failed to update topic' });
    }
});

// Delete a topic
router.delete('/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM topics WHERE id = $1 AND user_id = $2 RETURNING *',
            [req.params.id, req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Topic not found or unauthorized' });
        }

        req.app.get('io').emit('workspace-update');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete topic' });
    }
});

export default router;
