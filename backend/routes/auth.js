import express from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { pool } from '../db/index.js';
import dotenv from 'dotenv';
dotenv.config();

const router = express.Router();

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        done(null, result.rows[0]);
    } catch (err) { done(err); }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID || 'mock',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'mock',
    callbackURL: process.env.GOOGLE_CALLBACK_URL || "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
      try {
          const userEmail = (profile.emails && profile.emails[0] && profile.emails[0].value) ? profile.emails[0].value : null;
          let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
          if (result.rows.length > 0) {
              await pool.query('UPDATE users SET email = COALESCE($1, email), google_access_token = $2, google_refresh_token = COALESCE($3, google_refresh_token) WHERE google_id = $4', [userEmail, accessToken, refreshToken, profile.id]);
              const updatedResult = await pool.query('SELECT * FROM users WHERE google_id = $1', [profile.id]);
              return done(null, updatedResult.rows[0]);
          }
          result = await pool.query('INSERT INTO users (google_id, username, email, google_access_token, google_refresh_token) VALUES ($1, $2, $3, $4, $5) RETURNING *', [profile.id, profile.displayName, userEmail, accessToken, refreshToken]);
          return done(null, result.rows[0]);
      } catch (err) { return done(err); }
  }
));

router.get('/google', passport.authenticate('google', {
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive.readonly'],
    accessType: 'offline',
    prompt: 'consent'
}));

router.get('/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));

router.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.json({ message: 'Logged out' });
    });
});

export default router;
