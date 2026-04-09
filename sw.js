// Service Worker for FAForever Patchnotes PWA
const CACHE_NAME = 'faforever-patchnotes-v2.3.1';
const STATIC_CACHE = 'static-v2.3.1';
const DYNAMIC_CACHE = 'dynamic-v2.3.1';
const CSS_CACHE = 'css-v2.3.1';

// Cache version - increment this when styles change
const CACHE_VERSION = '2.3.1';

// Assets to cache immediately (excluding CSS to allow fresh loading)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/404.html',
  '/manifest.json',
  '/scripts/logger.js',
  '/scripts/populatePatches.js',
  '/scripts/search.js',
  '/scripts/coreUI.js',
  '/scripts/lazyLoader.js',
  '/scripts/keyboardShortcuts.js',
  '/scripts/errorBoundary.js',
  '/scripts/performance.js',
  '/scripts/analytics.js',
  '/scripts/contentSidemenu.js',
  '/scripts/headConfig.js',
  '/scripts/backToTop.js',
  '/scripts/pwa.js',
  '/assets/images/faction/UEF.svg',
  '/assets/images/faction/Cybran.svg',
  '/assets/images/faction/Aeon.svg',
  '/assets/images/faction/Seraphim.svg',
  '/assets/images/icons/icon-72x72.svg',
  '/assets/images/icons/icon-192x192.svg',
  '/assets/data/patches.json',
  '/favicon.ico'
];

// CSS files that should be force-refreshed
const CSS_ASSETS = [
  '/style/index.css',
  '/style/root.css',
  '/style/balance.css',
  '/style/critical.css',
  '/style/pwa.css',
  '/style/components/keyboard-shortcuts.css',
  '/style/components/pwa-cache.css',
  '/style/components/accessibility.css'
];

// Install event - cache static assets
self.addEventListener('install', event => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('Service Worker: Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('Service Worker: Static assets cached');
        return self.skipWaiting();
      })
      .catch(err => console.log('Service Worker: Cache failed', err))
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== STATIC_CACHE && cache !== DYNAMIC_CACHE && cache !== CSS_CACHE) {
            console.log('Service Worker: Clearing old cache', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      console.log('Service Worker: Activated');
      return self.clients.claim();
    })
  );
});

// Fetch event - serve from cache with network fallback
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip external requests
  if (!event.request.url.startsWith(self.location.origin)) return;

  // Special handling for CSS files with cache-busting
  if (event.request.url.includes('.css')) {
    event.respondWith(
      handleCSSRequest(event.request)
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          console.log('Service Worker: Serving from cache', event.request.url);
          return cachedResponse;
        }

        // Not in cache, fetch from network
        return fetch(event.request)
          .then(response => {
            // Check if valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clone response for caching
            const responseToCache = response.clone();

            // Cache patch pages and assets dynamically
            if (event.request.url.includes('/pages/') || 
                event.request.url.includes('/assets/')) {
              caches.open(DYNAMIC_CACHE)
                .then(cache => {
                  console.log('Service Worker: Caching dynamic asset', event.request.url);
                  cache.put(event.request, responseToCache);
                });
            }

            return response;
          })
          .catch(() => {
            // Network failed, try to serve offline page for HTML requests
            if (event.request.headers.get('accept').includes('text/html')) {
              return caches.match('/index.html');
            }
          });
      })
  );
});

// Special CSS handling function
async function handleCSSRequest(request) {
  try {
    console.log('Service Worker: Handling CSS request', request.url);
    
    // Always try network first for CSS files with version parameters
    if (request.url.includes('?v=') || request.url.includes('cache=bypass')) {
      console.log('Service Worker: Bypassing cache for versioned CSS', request.url);
      const response = await fetch(request);
      
      if (response && response.status === 200) {
        // Cache the new version
        const cache = await caches.open(CSS_CACHE);
        cache.put(request, response.clone());
        return response;
      }
    }
    
    // Try cache first for regular CSS requests
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      console.log('Service Worker: Serving CSS from cache', request.url);
      
      // Also try to update in background
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            caches.open(CSS_CACHE).then(cache => {
              cache.put(request, response);
            });
          }
        })
        .catch(() => {}); // Ignore background update errors
      
      return cachedResponse;
    }
    
    // Fallback to network
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(CSS_CACHE);
      cache.put(request, response.clone());
    }
    return response;
    
  } catch (error) {
    console.error('Service Worker: CSS request failed', error);
    return new Response('/* CSS loading failed */', {
      headers: { 'Content-Type': 'text/css' }
    });
  }
}

// Background sync for when connection is restored
self.addEventListener('sync', event => {
  if (event.tag === 'background-sync') {
    console.log('Service Worker: Background sync');
    // Could update cache with latest patches when connection restored
  }
});

// Message event - handle cache clearing requests
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    console.log('Service Worker: Clearing cache on request');
    event.waitUntil(
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            console.log('Service Worker: Deleting cache', cacheName);
            return caches.delete(cacheName);
          })
        );
      }).then(() => {
        console.log('Service Worker: All caches cleared');
        event.ports[0].postMessage({ success: true });
      })
    );
  }
  
  if (event.data && event.data.type === 'CLEAR_CSS_CACHE') {
    console.log('Service Worker: Clearing CSS cache on request');
    event.waitUntil(
      caches.delete(CSS_CACHE).then(() => {
        console.log('Service Worker: CSS cache cleared');
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});

// Push notifications (future feature)
self.addEventListener('push', event => {
  if (event.data) {
    const data = event.data.json();
    console.log('Service Worker: Push received', data);
    
    const options = {
      body: data.body || 'New FAForever patch available!',
      icon: '/assets/images/icons/icon-192x192.svg',
      badge: '/assets/images/icons/icon-72x72.svg',
      tag: 'patch-notification',
      data: data.url || '/',
      actions: [
        {
          action: 'view',
          title: 'View Patch',
          icon: '/assets/images/icons/icon-72x72.svg'
        },
        {
          action: 'dismiss',
          title: 'Dismiss'
        }
      ]
    };

    event.waitUntil(
      self.registration.showNotification(data.title || 'FAForever Patchnotes', options)
    );
  }
});

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'view') {
    event.waitUntil(
      clients.openWindow(event.notification.data || '/')
    );
  }
});
