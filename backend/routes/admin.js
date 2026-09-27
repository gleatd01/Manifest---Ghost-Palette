import express from 'express';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

const router = express.Router();
const ADMIN_EMAIL = 'taylor.d.gleason@gmail.com';

function ensureAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    if (!req.user.email || req.user.email.toLowerCase() !== ADMIN_EMAIL) {
        return res.status(403).json({ error: 'Access denied: Admin privileges required.' });
    }
    next();
}

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Get all registered users and their subscription/offline token status (Admin only)
 *     security:
 *       - CookieAuth: []
 *       - ApiKeyAuth: []
 *     responses:
 *       200:
 *         description: List of users with subscription status
 *       403:
 *         description: Forbidden
 */
router.get('/users', ensureAuthenticatedOrApiKey, ensureAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, email, plan_type, stripe_customer_id,
                    (google_refresh_token IS NOT NULL) AS has_offline_token
             FROM users ORDER BY id ASC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error("Admin fetch users error:", err);
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

/**
 * @swagger
 * /api/admin/users/{id}/plan:
 *   put:
 *     summary: Update a user's subscription plan tier (Admin manual override)
 *     security:
 *       - CookieAuth: []
 *       - ApiKeyAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - plan_type
 *             properties:
 *               plan_type:
 *                 type: string
 *                 example: "pro"
 *     responses:
 *       200:
 *         description: Plan updated successfully
 *       403:
 *         description: Forbidden
 */
router.put('/users/:id/plan', ensureAuthenticatedOrApiKey, ensureAdmin, async (req, res) => {
    const { plan_type } = req.body;
    if (!plan_type || typeof plan_type !== 'string') {
        return res.status(400).json({ error: 'Valid plan_type is required' });
    }
    const cleanPlan = plan_type.toLowerCase().trim();
    if (!['free', 'pro', 'paid'].includes(cleanPlan)) {
        return res.status(400).json({ error: 'Invalid plan_type value' });
    }

    try {
        const result = await pool.query(
            'UPDATE users SET plan_type = $1 WHERE id = $2 RETURNING id, username, email, plan_type',
            [cleanPlan, req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error("Admin update plan error:", err);
        res.status(500).json({ error: 'Failed to update user plan' });
    }
});

export default router;
