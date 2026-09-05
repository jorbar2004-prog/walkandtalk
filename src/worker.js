// Cada "canal" (room) es un Durable Object propio: Cloudflare lo crea la
// primera vez que alguien lo pide (por nombre) y lo mantiene vivo mientras
// haya sockets conectados. No hace falta base de datos ni servidor propio.

export class Room {
  constructor(state, env) {
    this.state = state;
    this.sockets = []; // [{ ws, name }] — máximo 2 por canal
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Se esperaba una conexión websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  handleSession(ws) {
    ws.addEventListener('message', event => {
      let m;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }

      if (m.type === 'join') {
        const name = String(m.name || 'Usuario').slice(0, 24);

        if (this.sockets.length >= 2) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Canal lleno (máx. 2 personas). Probá con otro nombre de canal.',
          }));
          ws.close(1000, 'room-full');
          return;
        }

        this.sockets.push({ ws, name });

        if (this.sockets.length === 1) {
          ws.send(JSON.stringify({ type: 'waiting' }));
        } else {
          const [first, second] = this.sockets;
          first.ws.send(JSON.stringify({ type: 'peer', name: second.name, initiator: true }));
          second.ws.send(JSON.stringify({ type: 'peer', name: first.name, initiator: false }));
        }
      }

      if (m.type === 'signal') {
        for (const s of this.sockets) {
          if (s.ws !== ws && s.ws.readyState === 1) {
            s.ws.send(JSON.stringify({ type: 'signal', data: m.data }));
          }
        }
      }
    });

    const cleanup = () => {
      const idx = this.sockets.findIndex(s => s.ws === ws);
      if (idx === -1) return;
      this.sockets.splice(idx, 1);
      for (const s of this.sockets) {
        s.ws.send(JSON.stringify({ type: 'peer-left' }));
      }
    };
    ws.addEventListener('close', cleanup);
    ws.addEventListener('error', cleanup);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/signal') {
      const room = (url.searchParams.get('room') || 'general').slice(0, 32);
      const id = env.ROOMS.idFromName(room);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    // Todo lo demás (index.html, app.js, css, manifest, íconos, sw.js) sale
    // servido tal cual desde /public gracias al binding de assets estáticos.
    return env.ASSETS.fetch(request);
  },
};
