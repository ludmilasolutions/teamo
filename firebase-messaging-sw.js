// Service Worker para PWA y funcionalidad offline
const CACHE_NAME = 'eco-familia-v1';
const OFFLINE_URL = '/offline.html';

// Archivos a cachear para funcionamiento offline
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// Instalación - Cachear recursos esenciales
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache abierto');
        return cache.addAll(PRECACHE_URLS);
      })
      .then(self.skipWaiting())
  );
});

// Activación - Limpiar caches antiguos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Eliminando cache antiguo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia de cache: Network First para datos, Cache First para assets
self.addEventListener('fetch', event => {
  // Ignorar solicitudes a Firebase (manejadas por SDK)
  if (event.request.url.includes('firestore.googleapis.com') ||
      event.request.url.includes('firebasestorage.googleapis.com') ||
      event.request.url.includes('identitytoolkit.googleapis.com')) {
    return;
  }

  // Para documentos HTML, intentar network primero
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match(OFFLINE_URL || '/index.html');
        })
    );
    return;
  }

  // Para assets estáticos, cache primero
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }
        
        // Clonar la solicitud porque es un stream
        const fetchRequest = event.request.clone();
        
        return fetch(fetchRequest).then(response => {
          // Verificar respuesta válida
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          
          // Clonar la respuesta porque es un stream
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          
          return response;
        });
      })
      .catch(() => {
        // Si falla todo, mostrar offline page
        if (event.request.mode === 'navigate') {
          return caches.match(OFFLINE_URL || '/index.html');
        }
      })
  );
});

// Sincronización en background (cuando vuelve la conexión)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-movements') {
    event.waitUntil(syncMovements());
  }
});

// Manejo de push notifications
self.addEventListener('push', event => {
  if (!event.data) return;
  
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.icon || 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4b0.png',
    badge: 'https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/1f4b0.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'open',
        title: 'Abrir app'
      },
      {
        action: 'close',
        title: 'Cerrar'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  if (event.action === 'open') {
    event.waitUntil(
      clients.matchAll({type: 'window'}).then(windowClients => {
        for (let client of windowClients) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
    );
  }
});

// Función para sincronizar movimientos pendientes
async function syncMovements() {
  // Implementar lógica para sincronizar movimientos pendientes
  // cuando el dispositivo recupera conexión
  console.log('Sincronizando movimientos pendientes...');
}
