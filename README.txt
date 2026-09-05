WIFI WALKIE-TALKIE — versión Cloudflare (Worker + Durable Objects)

QUÉ ES ESTO
Es la misma app (push-to-talk por WebRTC), pero en vez de un servidor Node
corriendo en tu PC, la señalización vive en un Cloudflare Worker con un
Durable Object por canal. Ventajas sobre la versión LAN:

- HTTPS real de Cloudflare: sin advertencia de certificado en el celular.
- Ya no depende de que una PC esté prendida y conectada al Wi-Fi.
- Funciona entre dos dispositivos en redes distintas (con internet), no
  solo en la misma red local.
- Instalable como PWA (icono en pantalla de inicio) igual que antes.

ESTRUCTURA DEL PROYECTO
  wrangler.toml       → configuración del Worker (assets + Durable Object)
  src/worker.js        → sirve los archivos estáticos y maneja /signal
  public/               → todo el frontend (index.html, app.js, css, iconos)

OPCIÓN A — Deploy manual con Wrangler (rápido, para probar ya)
1. Necesitás Node.js instalado y una cuenta de Cloudflare (gratis).
2. Adentro de esta carpeta:
     npm install
     npx wrangler login        (una sola vez, abre el navegador)
     npx wrangler deploy
3. Wrangler va a imprimir la URL final, algo como:
     https://wifi-walkie-talkie.<tu-subdominio>.workers.dev
   Esa URL ya es HTTPS válido — se puede abrir directo desde cualquier
   celular con internet, sin advertencias.

OPCIÓN B — Deploy conectado a GitHub (como tus otros proyectos)
1. Subí esta carpeta a un repo de GitHub.
2. En el dashboard de Cloudflare: Compute (Workers) → Create → "Import a
   repository" → elegí el repo. Cloudflare detecta el wrangler.toml solo.
3. Cada push a main vuelve a desplegar automáticamente, igual que con
   Eterneura o Diseñador de Muebles en Pages.

PARA PROBARLA DESDE EL CELULAR
1. Abrí la URL del Worker en Chrome (o el navegador que uses).
2. Dale permiso de micrófono cuando lo pida.
3. Elegí un nombre y un canal, tocá "Conectar".
4. Abrí la misma URL en el otro dispositivo (puede estar en otro Wi-Fi o
   con datos móviles), mismo canal, otro nombre, "Conectar".
5. Mantené presionado el botón para hablar.
6. Opcional: menú (⋮) → "Instalar app" para tenerla como ícono aparte.

LÍMITES DE ESTA VERSIÓN
- Un canal admite 2 personas, como antes.
- El audio en sí (WebRTC) sigue siendo P2P directo entre los dos
  dispositivos; Cloudflare solo hace de "cartero" para el handshake
  inicial. En redes muy restrictivas (NAT simétrico, algunos firewalls
  corporativos) puede no lograr conectar sin un servidor TURN — si eso
  pasa seguido, se puede sumar Cloudflare Realtime (TURN) más adelante.
- El plan gratuito de Cloudflare Workers incluye Durable Objects con
  límites generosos para este uso (bajo tráfico, sin necesidad de
  almacenamiento persistente); si el proyecto crece mucho en uso
  simultáneo conviene revisar los límites actuales en el dashboard.
