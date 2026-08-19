import express from 'express';
import { google } from 'googleapis';
import multer from 'multer';
import stream from 'stream';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import { pool } from '../db/index.js';
import { ensureAuthenticatedOrApiKey } from '../middleware/auth.js';

dotenv.config();

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

router.get('/drive/download/:id', ensureAuthenticatedOrApiKey, async (req, res) => {
    if (!req.user.google_access_token) return res.status(403).json({ error: 'Google Auth missing.' });
    try {
        const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ access_token: req.user.google_access_token, refresh_token: req.user.google_refresh_token });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const driveRes = await drive.files.get({ fileId: req.params.id, alt: 'media' }, { responseType: 'stream' });
        driveRes.data.pipe(res);
    } catch (err) {
        console.error("Drive API Download Error:", err);
        res.status(500).send('Error downloading file.');
    }
});

router.post('/drive/upload', ensureAuthenticatedOrApiKey, upload.single('file'), async (req, res) => {
    if (!req.user.google_access_token) return res.status(403).json({ error: 'Google Auth missing.' });
    try {
        const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
        oauth2Client.setCredentials({ access_token: req.user.google_access_token, refresh_token: req.user.google_refresh_token });
        const drive = google.drive({ version: 'v3', auth: oauth2Client });

        const folderName = 'manifest-ghost';
        let folderId = null;

        const queryResponse = await drive.files.list({
            q: `mimeType='application/vnd.google-apps.folder' and name='${folderName}' and trashed=false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        if (queryResponse.data.files && queryResponse.data.files.length > 0) {
            folderId = queryResponse.data.files[0].id;
        } else {
            const folderMetadata = { name: folderName, mimeType: 'application/vnd.google-apps.folder' };
            const folder = await drive.files.create({ resource: folderMetadata, fields: 'id' });
            folderId = folder.data.id;
        }

        const bufferStream = new stream.PassThrough();
        bufferStream.end(req.file.buffer);

        const response = await drive.files.create({
            requestBody: { name: req.file.originalname, parents: [folderId] },
            media: { mimeType: req.file.mimetype, body: bufferStream },
            fields: 'id, webViewLink'
        });

        res.json({ fileId: response.data.id, link: response.data.webViewLink });
    } catch (err) {
        console.error("Drive API Error:", err);
        res.status(500).json({ error: 'Drive upload failed.' });
    }
});

router.post('/checkout', ensureAuthenticatedOrApiKey, async (req, res) => {
    try {
        let customerId = req.user.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({ email: 'user@example.com', metadata: { userId: req.user.id.toString() } });
            customerId = customer.id;
            await pool.query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, req.user.id]);
        }
        const session = await stripe.checkout.sessions.create({ customer: customerId, payment_method_types: ['card'], line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }], mode: 'subscription', success_url: `${req.headers.origin}/?billing=success`, cancel_url: `${req.headers.origin}/?billing=cancel` });
        res.json({ url: session.url });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/push/subscribe', ensureAuthenticatedOrApiKey, (req, res) => {
    const { subscription, timezone } = req.body;
    if (timezone) {
        pool.query(`UPDATE users SET timezone = $1 WHERE id = $2`, [timezone, req.user.id]).catch(console.error);
    }
    res.status(200).json({ success: true, message: "Push and Timezone configured" });
});

export default router;
