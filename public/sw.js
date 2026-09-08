// Service worker mínimo: solo lo necesario para que Chrome/Android considere
// la app "instalable". No cachea audio ni WebSocket, así que el walkie-talkie
// en sí sigue necesitando la red local para funcionar.
const CACHE = 'wifi-walkie-talkie-v1';
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});

// --- "Llamada de conexión": muestra la notificación aunque la app esté cerrada ---
self.addEventListener('push', event => {
  let data = { title: '📡 Llamada de conexión', body: 'Alguien quiere hablar' };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // si no viene como JSON válido, usamos el texto de reserva de arriba
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      vibrate: [200, 100, 200],
      tag: 'walkie-llamada',
      renotify: true,
    })
  );
});

// Al tocar la notificación, abre la app (o la trae al frente si ya está abierta).
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
