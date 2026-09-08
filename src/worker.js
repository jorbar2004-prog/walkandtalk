import { buildPushPayload } from '@block65/webcrypto-web-push';

// Cada "canal" (room) es un Durable Object propio: Cloudflare lo crea la
// primera vez que alguien lo pide (por nombre) y lo mantiene vivo mientras
// haya sockets conectados. La base de datos SQLite que trae cada Durable
// Object guarda las suscripciones push, así sobreviven aunque el canal
// quede sin nadie conectado por un rato.

export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sockets = []; // [{ ws, name, alive }] — máximo 2 por canal
    this.heartbeatInterval = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/subscribe' && request.method === 'POST') {
      return this.handleSubscribe(request);
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Se esperaba una conexión websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.handleSession(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Guarda (o actualiza) la suscripción push de una persona para este canal.
  async handleSubscribe(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('JSON inválido', { status: 400 });
    }
    const name = String(body.name || '').slice(0, 24);
    if (!name || !body.subscription || !body.subscription.endpoint) {
      return new Response('Faltan datos', { status: 400 });
    }
    await this.state.storage.put('sub:' + name, body.subscription);
    return new Response('ok');
  }

  // Avisa por push a todas las suscripciones guardadas de este canal, menos
  // la de quien se acaba de conectar (para no auto-notificarse).
  async notifyOthers(exceptName) {
    const vapidPublicKey = this.env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = this.env.VAPID_PRIVATE_KEY;
    if (!vapidPublicKey || !vapidPrivateKey) return; // push no configurado todavía

    const vapid = {
      subject: this.env.VAPID_SUBJECT || 'mailto:admin@example.com',
      publicKey: vapidPublicKey,
      privateKey: vapidPrivateKey,
    };
    const message = {
      data: JSON.stringify({
        title: '📡 Llamada de conexión',
        body: `${exceptName} quiere hablar por WiFi Walkie-Talkie`,
      }),
      options: { ttl: 30 },
    };

    const subs = await this.state.storage.list({ prefix: 'sub:' });
    for (const [key, subscription] of subs) {
      if (key === 'sub:' + exceptName) continue;
      try {
        const payload = await buildPushPayload(message, subscription, vapid);
        const res = await fetch(subscription.endpoint, payload);
        if (res.status === 404 || res.status === 410) {
          await this.state.storage.delete(key); // suscripción vencida o revocada
        }
      } catch {
        // Si un push falla no debe romper el resto del flujo (emparejar, etc.)
      }
    }
  }

  // "Latido": cada 15s le pregunta a cada socket si sigue vivo. Si uno no
  // contestó el latido anterior, se considera muerto (el celular se quedó
  // sin señal, Android mató la pestaña de fondo, etc.) y se libera su
  // lugar en el canal — así no queda "ocupado" para siempre por un fantasma.
  startHeartbeat() {
    if (this.heartbeatInterval) return;
    this.heartbeatInterval = setInterval(() => {
      for (const s of [...this.sockets]) {
        if (s.alive === false) {
          try { s.ws.close(); } catch {}
          this.removeSocket(s.ws);
          continue;
        }
        s.alive = false;
        try { s.ws.send(JSON.stringify({ type: 'ping' })); } catch {}
      }
      if (this.sockets.length === 0 && this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }
    }, 15000);
  }

  removeSocket(ws) {
    const idx = this.sockets.findIndex(s => s.ws === ws);
    if (idx === -1) return;
    this.sockets.splice(idx, 1);
    for (const s of this.sockets) {
      try { s.ws.send(JSON.stringify({ type: 'peer-left' })); } catch {}
    }
  }

  handleSession(ws) {
    ws.addEventListener('message', async event => {
      let m;
      try {
        m = JSON.parse(event.data);
      } catch {
        return;
      }

      if (m.type === 'pong') {
        const s = this.sockets.find(s => s.ws === ws);
        if (s) s.alive = true;
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

        const wasEmpty = this.sockets.length === 0;
        this.sockets.push({ ws, name, alive: true });
        this.startHeartbeat();

        if (this.sockets.length === 1) {
          ws.send(JSON.stringify({ type: 'waiting' }));
          if (wasEmpty) {
            try { await this.notifyOthers(name); } catch {}
          }
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

    ws.addEventListener('close', () => this.removeSocket(ws));
    ws.addEventListener('error', () => this.removeSocket(ws));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/signal' || url.pathname === '/subscribe') {
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
