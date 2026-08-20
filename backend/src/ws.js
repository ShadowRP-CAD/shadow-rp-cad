import { WebSocketServer, WebSocket } from 'ws';
import { resolveWebTokenUser } from './auth.js';

export function createWebSocketHub(server, sessionMiddleware, db) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    const { pathname } = requestUrl;
    if (pathname !== '/ws') return socket.destroy();
    sessionMiddleware(request, {}, () => {
      let user = request.session?.userId
        ? db.prepare('SELECT id, role FROM users WHERE id = ?').get(request.session.userId)
        : null;
      if (!user) user = resolveWebTokenUser(db, requestUrl.searchParams.get('token') || '');
      if (!user) return socket.destroy();
      request.user = user;
      wss.handleUpgrade(request, socket, head, ws => {
        ws.userRole = user.role;
        wss.emit('connection', ws, request);
      });
    });
  });

  wss.on('connection', ws => {
    ws.send(JSON.stringify({ type: 'connected', data: { at: new Date().toISOString() } }));
  });

  return {
    broadcast(type, data) {
      const message = JSON.stringify({ type, data });
      const cadOnly = type.startsWith('call.') || type.startsWith('dispatch.') || type.startsWith('unit.') || type.startsWith('bolo.');
      const cadRoles = ['LEO', 'EMS', 'DISPATCH', 'ADMIN'];
      for (const client of wss.clients) {
        if (client.readyState !== WebSocket.OPEN) continue;
        if (cadOnly && !cadRoles.includes(client.userRole)) continue;
        client.send(message);
      }
    },
    close() { wss.close(); }
  };
}
