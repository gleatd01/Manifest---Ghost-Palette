import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';
dotenv.config();

export const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    user: process.env.POSTGRES_USER,
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT || 5432,
});

export async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE, google_id VARCHAR(255) UNIQUE, plan_type VARCHAR(50) DEFAULT 'free', stripe_customer_id VARCHAR(255));`);
        try { await pool.query(`ALTER TABLE users ADD COLUMN google_access_token TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN google_refresh_token TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC'`); } catch (e) {}

        await pool.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false, due_date DATE, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        try { await pool.query(`ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN pdf_url VARCHAR(1024)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN audio_url VARCHAR(1024)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN transcription TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN drive_pdf_id VARCHAR(255)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN drive_audio_id VARCHAR(255)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN slide_tracking TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN predecessors JSONB DEFAULT '[]'`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN assignees JSONB DEFAULT '[]'`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN reminder_time VARCHAR(50)`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN reminder_frequency VARCHAR(50)`); } catch (e) {}

        await pool.query(`CREATE TABLE IF NOT EXISTS user_api_keys (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, key_name VARCHAR(100) NOT NULL, api_key_hash VARCHAR(64) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        console.log("Database initialized.");
    } catch (err) { console.error("DB Error:", err); }
}
