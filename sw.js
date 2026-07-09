// Firebase App Check & Messaging importScripts
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const CACHE_NAME = 'zermelo-uitval-v2';

// Firebase config
firebase.initializeApp({
  apiKey: "AIzaSyDtvIeeqA9D17J-AV2Y7OtlbagbjNv8VDY",
  authDomain: "zermelo-12ec9.firebaseapp.com",
  projectId: "zermelo-12ec9",
  storageBucket: "zermelo-12ec9.firebasestorage.app",
  messagingSenderId: "232411919170",
  appId: "1:232411919170:web:50e7f35cde47ccbe738edb"
});

const messaging = firebase.messaging();

// Achtergrond push-melding handler (als app DICHT is)
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Achtergrond melding ontvangen:', payload);
  const { title, body, icon } = payload.notification || {};
  self.registration.showNotification(title || 'Zermelo Uitval', {
    body: body || 'Er is een wijziging in je rooster.',
    icon: icon || 'icon-192.png',
    badge: 'icon-192.png',
    vibrate: [200, 100, 200],
    tag: 'uitval-' + Date.now(),
    data: payload.data || {},
  });
});

// ── Cache install ──
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(['index.html', 'manifest.json'])
    )
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// ── Fetch strategie ──
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('zportal.nl')) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}
