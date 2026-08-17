import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { createDatabase, seedDatabase } from './db.js';
import { createWebSocketHub } from './ws.js';

const db = createDatabase();
if (config.nodeEnv !== 'production') seedDatabase(db);
let hub = { broadcast() {} };
const { app, sessionMiddleware } = createApp(db, { broadcast: (...args) => hub.broadcast(...args) });
const server = http.createServer(app);
hub = createWebSocketHub(server, sessionMiddleware, db);

server.listen(config.port, () => console.log(`Shadow RP CAD API listening on ${config.publicApiUrl}`));

function shutdown() {
  hub.close();
  server.close(() => { db.close(); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
