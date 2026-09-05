const $ = id => document.getElementById(id);
const statusEl = $('status'), connectBtn = $('connect'), talkBtn = $('talk'),
  peerEl = $('peer'), hintEl = $('hint'), unlockBtn = $('unlockAudio');

let ws = null, pc = null, localStream = null, remoteAudio = null;
let room = '', name = '', connected = false, wakeLock = null;

function setStatus(text, ok = false) {
  statusEl.textContent = text;
  statusEl.style.color = ok ? '#22c55e' : '#f59e0b';
}

function vibrate(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// Evita que la pantalla se apague mientras la app está en uso.
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) {
    // No es crítico si falla (algunos navegadores/Android WebView no lo soportan).
  }
}
function releaseWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && connected) requestWakeLock();
});

async function start() {
  name = $('name').value.trim() || 'Usuario';
  room = $('room').value.trim() || 'general';

  localStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
  // Arranca en silencio: recién transmite cuando se mantiene presionado el botón.
  localStream.getAudioTracks().forEach(t => (t.enabled = false));

  // El canal ("room") viaja en la URL: el Worker usa ese nombre para elegir
  // el Durable Object (la "sala") a la que hay que conectarse.
  const wsProto = location.protocol === 'https:' ? 'wss://' : 'ws://';
  ws = new WebSocket(wsProto + location.host + '/signal?room=' + encodeURIComponent(room));

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', room, name }));
    setStatus('Conectado al servidor', true);
    connected = true;
    connectBtn.textContent = 'Desconectar';
    connectBtn.disabled = false;
    requestWakeLock();
  };

  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.type === 'waiting') {
      peerEl.textContent = '🟡 Esperando a alguien más en este canal…';
      hintEl.textContent = 'Abrí la misma app y el mismo canal en otro celular.';
    }
    if (m.type === 'peer') {
      peerEl.textContent = '🟢 ' + m.name;
      hintEl.textContent = 'Mantené presionado para transmitir.';
      talkBtn.disabled = false;
      vibrate(80);
      await createPeer(m.initiator);
    }
    if (m.type === 'signal') await handleSignal(m.data);
    if (m.type === 'peer-left') {
      peerEl.textContent = 'Sin conexión';
      hintEl.textContent = 'Esperando a alguien más en este canal…';
      talkBtn.disabled = true;
      closePeer();
    }
    if (m.type === 'error') {
      setStatus(m.message);
      stop();
    }
  };
  ws.onclose = () => {
    if (connected) setStatus('Servidor desconectado');
    connected = false;
  };
  ws.onerror = () => setStatus('Error de conexión');
}

async function createPeer(initiator) {
  closePeer();
  // Al ya no estar limitado a la misma red Wi-Fi, hace falta STUN público
  // para que cada lado descubra su dirección accesible desde internet.
  pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.ontrack = e => {
    if (!remoteAudio) {
      remoteAudio = document.createElement('audio');
      remoteAudio.id = 'remoteAudio';
      remoteAudio.autoplay = true;
      remoteAudio.playsInline = true; // necesario en móviles para no forzar pantalla completa
      document.body.appendChild(remoteAudio);
    }
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.play().catch(() => {
      // Algunos navegadores móviles bloquean el autoplay: mostramos un botón para destrabarlo.
      unlockBtn.hidden = false;
    });
  };

  pc.onicecandidate = e => {
    if (e.candidate) ws.send(JSON.stringify({ type: 'signal', room, data: { candidate: e.candidate } }));
  };

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'signal', room, data: { description: pc.localDescription } }));
  }
}

async function handleSignal(data) {
  if (!pc) await createPeer(false);
  if (data.description) {
    await pc.setRemoteDescription(data.description);
    if (data.description.type === 'offer') {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'signal', room, data: { description: pc.localDescription } }));
    }
  } else if (data.candidate) {
    try { await pc.addIceCandidate(data.candidate); } catch (e) {}
  }
}

function closePeer() {
  if (pc) { pc.close(); pc = null; }
  if (remoteAudio) { remoteAudio.remove(); remoteAudio = null; }
}

function stop() {
  connected = false;
  closePeer();
  if (ws) { ws.close(); ws = null; }
  if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
  releaseWakeLock();
  connectBtn.textContent = 'Conectar';
  connectBtn.disabled = false;
  talkBtn.disabled = true;
  talkBtn.classList.remove('active');
  peerEl.textContent = 'Sin conexión';
  hintEl.textContent = 'Conectá primero.';
  unlockBtn.hidden = true;
  setStatus('Desconectado');
}

connectBtn.onclick = async () => {
  if (connected) { stop(); return; }
  connectBtn.disabled = true;
  try {
    await start();
  } catch (e) {
    setStatus('No se pudo acceder al micrófono (revisá los permisos del navegador)');
    connectBtn.disabled = false;
  }
};

unlockBtn.onclick = () => {
  if (remoteAudio) remoteAudio.play().catch(() => {});
  unlockBtn.hidden = true;
};

function speaking(on) {
  if (!localStream || !connected) return;
  localStream.getAudioTracks().forEach(t => (t.enabled = on));
  talkBtn.classList.toggle('active', on);
  vibrate(on ? 30 : 15);
}
talkBtn.addEventListener('pointerdown', e => { e.preventDefault(); speaking(true); });
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => talkBtn.addEventListener(ev, () => speaking(false)));
talkBtn.addEventListener('contextmenu', e => e.preventDefault()); // evita el menú de "mantener presionado" en Android

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
