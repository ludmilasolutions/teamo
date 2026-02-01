// Nombre de la caché
const CACHE_NAME = 'familia-unida-v1';

// Archivos para cachear en la instalación
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  'https://unpkg.com/@supabase/supabase-js@2'
];

// Instalación del Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cacheando archivos estáticos');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activación y limpieza de cachés viejas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('Eliminando caché antigua:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Estrategia: Cache First, fallback a Network
self.addEventListener('fetch', event => {
  // Solo manejar peticiones GET
  if (event.request.method !== 'GET') return;

  // Excluir peticiones a Supabase (manejar online/offline en app)
  if (event.request.url.includes('supabase.co')) {
    event.respondWith(networkFirstStrategy(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Si hay respuesta en caché, usarla
        if (cachedResponse) {
          return cachedResponse;
        }

        // Si no, ir a la red
        return fetch(event.request)
          .then(networkResponse => {
            // Si es una respuesta válida, cachearla
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then(cache => {
                  cache.put(event.request, responseToCache);
                });
            }
            return networkResponse;
          })
          .catch(() => {
            // Si falla la red y es una página, servir offline.html
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// Estrategia: Network First para datos
async function networkFirstStrategy(request) {
  try {
    // Intentar red primero
    const networkResponse = await fetch(request);
    
    // Si tenemos respuesta, actualizar caché
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, networkResponse.clone());
    
    return networkResponse;
  } catch (error) {
    // Si falla la red, intentar con caché
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Si no hay en caché, devolver error
    return new Response(JSON.stringify({
      error: 'No hay conexión y no hay datos en caché'
    }), {
      status: 408,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Manejo de mensajes (para sincronización en segundo plano)
self.addEventListener('message', event => {
  if (event.data.type === 'SYNC_TRANSACTIONS') {
    event.waitUntil(syncTransactions());
  }
});

// Función para sincronizar transacciones offline
async function syncTransactions() {
  // Esta función se llamaría cuando se recupere la conexión
  // La lógica completa está en app.js
  console.log('Intentando sincronizar datos offline...');
  
  // Notificar a todas las pestañas abiertas
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({
      type: 'SYNC_REQUESTED'
    });
  });
}

// Manejo de push notifications
self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();
  
  const options = {
    body: data.body || 'Nueva actualización disponible',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/badge-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      url: data.url || '/'
    }
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Familia Unida', options)
  );
});

// Manejo de clics en notificaciones
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clientList => {
        // Buscar ventana abierta
        for (const client of clientList) {
          if (client.url === '/' && 'focus' in client) {
            return client.focus();
          }
        }
        
        // Si no hay ventana abierta, abrir una
        if (clients.openWindow) {
          return clients.openWindow(event.notification.data.url);
        }
      })
  );
});
