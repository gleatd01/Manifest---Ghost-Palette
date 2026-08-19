import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import session from 'express-session';
import passport from 'passport';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDB } from './db/index.js';
import { swaggerUi, swaggerSpecs } from './config/swagger.js';

import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import tasksRoutes from './routes/tasks.js';
import settingsRoutes from './routes/settings.js';
import integrationsRoutes from './routes/integrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.set('io', io); // make io available in routes via req.app.get('io')

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'ghost_palette_secret_key', resave: false, saveUninitialized: false }));

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs));
app.use(passport.initialize());
app.use(passport.session());

initDB();

app.use('/auth', authRoutes);
app.use('/api', usersRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api', integrationsRoutes);

// Update path to serve frontend build output from the correct directory relative to backend
app.use(express.static(path.join(__dirname, '../frontend/dist')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/dist', 'index.html')));

server.listen(PORT, () => console.log(`[v30.4 Handwriting] Server Running. Port: ${PORT}`));
