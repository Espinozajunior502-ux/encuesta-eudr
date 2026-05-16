// ══════════════════════════════════════════════════════
//  EUDR Megablessing — Service Worker v2.1
//  Estrategia: Cache-First con actualización en background
//  Garantiza funcionamiento 100% offline después de
//  la primera carga con internet.
// ══════════════════════════════════════════════════════

const CACHE_NAME = 'eudr-megablessing-v2.1';
const CACHE_FALLBACK = 'eudr-megablessing-fallback';

// Archivos que DEBEN estar en caché para que la app funcione
const CORE_FILES = [
  './eudr_koltiva_encuesta.html',
  './apple-touch-icon.png',
];

// ── INSTALL: guarda todo en caché al instalar ──
self.addEventListener('install', event => {
  console.log('[SW] Instalando versión', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Cacheando archivos principales...');
        // addAll falla si cualquier archivo falla — usamos add individual
        // para que un fallo en el icono no rompa todo
        return Promise.allSettled(
          CORE_FILES.map(file =>
            cache.add(file).catch(err => {
              console.warn('[SW] No se pudo cachear:', file, err.message);
            })
          )
        );
      })
      .then(() => {
        console.log('[SW] Instalación completa');
        // Fuerza activación inmediata sin esperar que cierren otros tabs
        return self.skipWaiting();
      })
  );
});

// ── ACTIVATE: limpia cachés viejos ──
self.addEventListener('activate', event => {
  console.log('[SW] Activando versión', CACHE_NAME);
  event.waitUntil(
    caches.keys()
      .then(keys => {
        return Promise.all(
          keys
            .filter(key => key !== CACHE_NAME && key !== CACHE_FALLBACK)
            .map(key => {
              console.log('[SW] Eliminando caché viejo:', key);
              return caches.delete(key);
            })
        );
      })
      .then(() => {
        console.log('[SW] Tomando control de todos los clientes');
        // Toma control inmediato de todos los tabs abiertos
        return self.clients.claim();
      })
  );
});

// ── FETCH: estrategia Cache-First con red como respaldo ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Solo maneja peticiones GET
  if (event.request.method !== 'GET') return;

  // No intercepta peticiones a otros dominios (analytics, etc)
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {

        // ── CACHE HIT: devuelve desde caché ──
        if (cachedResponse) {
          // En background, intenta actualizar el caché
          const fetchPromise = fetch(event.request)
            .then(networkResponse => {
              if (networkResponse && networkResponse.ok) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, networkResponse.clone());
                });
              }
              return networkResponse;
            })
            .catch(() => {
              // Sin internet — no pasa nada, ya tenemos caché
            });

          // Devuelve caché inmediatamente (no espera la red)
          return cachedResponse;
        }

        // ── CACHE MISS: intenta la red ──
        return fetch(event.request)
          .then(networkResponse => {
            if (!networkResponse || !networkResponse.ok) {
              return networkResponse;
            }

            // Guarda en caché para la próxima vez
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });

            return networkResponse;
          })
          .catch(err => {
            console.error('[SW] Sin internet y sin caché para:', event.request.url);

            // Fallback: si es navegación (HTML), intenta devolver el HTML principal
            if (event.request.mode === 'navigate') {
              return caches.match('./eudr_koltiva_encuesta.html')
                .then(fallback => {
                  if (fallback) {
                    console.log('[SW] Sirviendo fallback HTML');
                    return fallback;
                  }
                  // Si ni el HTML está en caché, devuelve página de error mínima
                  return new Response(
                    `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sin conexión</title>
<style>
  body{font-family:-apple-system,sans-serif;background:#111;color:#fff;display:flex;
  align-items:center;justify-content:center;min-height:100vh;flex-direction:column;text-align:center;padding:20px;}
  h1{font-size:48px;margin-bottom:16px;}
  p{font-size:16px;color:#999;margin-bottom:24px;}
  button{padding:14px 28px;background:#e40521;color:#fff;border:none;border-radius:10px;
  font-size:16px;font-weight:700;cursor:pointer;}
</style>
</head>
<body>
  <h1>📵</h1>
  <p>Sin conexión a internet.<br>La app no pudo cargarse.</p>
  <button onclick="location.reload()">Intentar de nuevo</button>
  <p style="margin-top:20px;font-size:12px;color:#555">
    Si este problema persiste, abre la app con WiFi<br>para restaurar el caché.
  </p>
</body>
</html>`,
                    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
                  );
                });
            }

            // Para otros recursos (imágenes, etc) devuelve error vacío
            return new Response('', { status: 503 });
          });
      })
  );
});

// ── MENSAJE: permite forzar actualización desde la app ──
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    console.log('[SW] Forzando actualización por solicitud del cliente');
    self.skipWaiting();
  }
  if (event.data === 'getVersion') {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

// ── VERIFICACION PERIODICA: cada vez que se activa comprueba integridad ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const keys = await cache.keys();
      const cachedURLs = keys.map(r => r.url);
      console.log('[SW] Archivos en caché:', cachedURLs.length);
      
      // Verifica que el HTML principal esté en caché
      const hasHTML = cachedURLs.some(url => url.includes('eudr_koltiva_encuesta.html'));
      if (!hasHTML) {
        console.warn('[SW] HTML principal no está en caché — reintentando...');
        try {
          await cache.add('./eudr_koltiva_encuesta.html');
          console.log('[SW] HTML principal recuperado OK');
        } catch(e) {
          console.error('[SW] No se pudo recuperar el HTML:', e.message);
        }
      }
    })
  );
});
