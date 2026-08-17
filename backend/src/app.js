import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import session from 'express-session';
import { config } from './config.js';
import { attachUser, registerAuthRoutes } from './auth.js';
import { createApiRouter } from './routes.js';
import { SQLiteSessionStore } from './sessionStore.js';

export function createApp(db, events = { broadcast() {} }) {
  const app = express();
  const frontendOrigin = new URL(config.frontendUrl).origin;
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: false }));
  app.use(cors({ origin: frontendOrigin, credentials: true }));
  // Enfusion RestContext may send a JSON string without an application/json header.
  app.use(express.json({
    limit: '256kb',
    type: ['application/json', 'text/plain', 'application/octet-stream', 'application/x-www-form-urlencoded']
  }));
  app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));
  const sessionMiddleware = session({
    name: 'srp.sid',
    secret: config.sessionSecret,
    store: new SQLiteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.nodeEnv === 'production',
      sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
      maxAge: 24 * 60 * 60 * 1000
    }
  });
  app.use(sessionMiddleware);
  app.use(attachUser(db));
  registerAuthRoutes(app, db);
  app.use('/api', createApiRouter(db, events));
  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: config.nodeEnv === 'production' ? 'Internal server error' : error.message });
  });
  return { app, sessionMiddleware };
}
