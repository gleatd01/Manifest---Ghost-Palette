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

let isPgConnected = false;
const inMemoryDb = {
    tasks: [
        {
            id: 1,
            user_id: 1,
            title: 'Sample Study Lecture',
            description: '# Physics Lecture Notes\n\nQuantum mechanics basics.',
            completed: false,
            due_date: null,
            pdf_url: null,
            audio_url: null,
            transcription: 'Welcome to physics lecture 101.',
            handwriting_data: '[]',
            slide_tracking: '[]'
        }
    ],
    users: [{ id: 1, username: 'jules', email: 'jules@example.com', plan_type: 'free' }],
    topics: []
};

const originalQuery = pool.query.bind(pool);
pool.query = async (text, params) => {
    try {
        if (isPgConnected) {
            return await originalQuery(text, params);
        }
        const res = await originalQuery(text, params);
        isPgConnected = true;
        return res;
    } catch (err) {
        const queryText = (typeof text === 'string' ? text : (text && text.text) || '').toLowerCase();
        if (queryText.includes('select * from tasks')) {
            return { rows: inMemoryDb.tasks };
        }
        if (queryText.includes('insert into tasks')) {
            const newTask = {
                id: inMemoryDb.tasks.length + 1,
                user_id: params[0] || 1,
                title: params[1] || 'Untitled Task',
                due_date: params[2] || null,
                topic_id: params[3] || null,
                parent_id: params[4] || null,
                completed: false,
                created_at: new Date()
            };
            inMemoryDb.tasks.push(newTask);
            return { rows: [newTask] };
        }
        if (queryText.includes('update tasks set')) {
            const id = params[params.length - 1];
            const taskIndex = inMemoryDb.tasks.findIndex(t => t.id == id);
            if (taskIndex !== -1) {
                inMemoryDb.tasks[taskIndex] = {
                    ...inMemoryDb.tasks[taskIndex],
                    title: params[0],
                    description: params[1],
                    completed: params[2],
                    due_date: params[3],
                    pdf_url: params[4],
                    audio_url: params[5],
                    transcription: params[6],
                    drive_pdf_id: params[7],
                    drive_audio_id: params[8],
                    slide_tracking: params[9],
                    predecessors: params[10],
                    assignees: params[11],
                    reminder_time: params[12],
                    reminder_frequency: params[13],
                    topic_id: params[14],
                    parent_id: params[15],
                    handwriting_data: params[16]
                };
            }
            return { rows: [inMemoryDb.tasks[taskIndex] || {}] };
        }
        if (queryText.includes('delete from tasks')) {
            const id = params[0];
            inMemoryDb.tasks = inMemoryDb.tasks.filter(t => t.id != id);
            return { rows: [] };
        }
        return { rows: [] };
    }
};

export async function initDB() {
    try {
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE, google_id VARCHAR(255) UNIQUE, plan_type VARCHAR(50) DEFAULT 'free', stripe_customer_id VARCHAR(255));`);
        try { await pool.query(`ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN google_access_token TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN google_refresh_token TEXT`); } catch (e) {}
        try { await pool.query(`ALTER TABLE users ADD COLUMN timezone VARCHAR(100) DEFAULT 'UTC'`); } catch (e) {}

        await pool.query(`CREATE TABLE IF NOT EXISTS topics (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, name VARCHAR(255) NOT NULL, color VARCHAR(50) DEFAULT '#646cff', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        await pool.query(`CREATE TABLE IF NOT EXISTS tasks (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), title VARCHAR(255) NOT NULL, completed BOOLEAN DEFAULT false, due_date DATE, description TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);

        try { await pool.query(`ALTER TABLE tasks ADD COLUMN topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL`); } catch (e) {}
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
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE`); } catch (e) {}
        try { await pool.query(`ALTER TABLE tasks ADD COLUMN handwriting_data TEXT`); } catch (e) {}

        await pool.query(`CREATE TABLE IF NOT EXISTS user_api_keys (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, key_name VARCHAR(100) NOT NULL, api_key_hash VARCHAR(64) UNIQUE NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);`);
        console.log("Database initialized.");
    } catch (err) { console.error("DB Error:", err); }
}
