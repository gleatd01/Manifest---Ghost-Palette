import express from 'express';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();

/**
 * @swagger
 * /api/tasks:
 *   get:
 *     summary: Get all tasks for the authenticated user
 *     security:
 *       - ApiKeyAuth: []
 *       - CookieAuth: []
 *     responses:
 *       200:
 *         description: A list of tasks.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                   title:
 *                     type: string
 *                   completed:
 *                     type: boolean
 *                   due_date:
 *                     type: string
 *                     format: date
 *       401:
 *         description: Unauthorized
 */
router.get('/', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tasks WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
        res.json(result.rows);
    }
    catch (err) { res.status(500).json({ error: 'Failed' }); }
});

/**
 * @swagger
 * /api/tasks:
 *   post:
 *     summary: Create a new task
 *     security:
 *       - ApiKeyAuth: []
 *       - CookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *               dueDate:
 *                 type: string
 *                 format: date
 *     responses:
 *       200:
 *         description: Task created.
 *       400:
 *         description: Bad request (e.g., missing title).
 *       401:
 *         description: Unauthorized
 */
router.post('/', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        const title = req.body.title ? req.body.title.trim() : '';
        if (!title) {
            return res.status(400).json({ error: 'Title is required and cannot be empty.' });
        }
        const result = await pool.query('INSERT INTO tasks (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING *', [req.user.id, title, req.body.dueDate || null]);
        req.app.get('io').emit('workspace-update');
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    const { title, description, completed, dueDate, predecessors, assignees, reminderTime, reminderFrequency, pdf_url, audio_url, transcription, drive_pdf_id, drive_audio_id, slide_tracking, topic_id } = req.body;
    try {
        await pool.query(`UPDATE tasks SET title=$1, description=$2, completed=$3, due_date=$4, pdf_url=$5, audio_url=$6, transcription=$7, drive_pdf_id=$8, drive_audio_id=$9, slide_tracking=$10, predecessors=$11, assignees=$12, reminder_time=$13, reminder_frequency=$14, topic_id=$15 WHERE id=$16`,
            [title, description || null, completed, dueDate || null, pdf_url || null, audio_url || null, transcription || null, drive_pdf_id || null, drive_audio_id || null, slide_tracking || null, JSON.stringify(predecessors || []), JSON.stringify(assignees || []), reminderTime || null, reminderFrequency || null, topic_id || null, req.params.id]);
        req.app.get('io').emit('workspace-update'); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

export default router;
