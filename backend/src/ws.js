import { WebSocketServer, WebSocket } from 'ws';

export function createWebSocketHub(server, sessionMiddleware, db) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url, 'http://localhost');
    if (pathname !== '/ws') return socket.destroy();
    sessionMiddleware(request, {}, () => {
      if (!request.session?.userId) return socket.destroy();
      const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(request.session.userId);
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
