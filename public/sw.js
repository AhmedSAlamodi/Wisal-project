const CACHE_NAME = 'wisal-app-shell-v2';
const APP_SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/apple-touch-icon.png',
];

const STATIC_IMAGE_PATHS = new Set([
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(
          APP_SHELL_URLS.map((url) =>
            cache.add(new Request(url, { cache: 'reload' }))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((oldKey) => caches.delete(oldKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // استثناء مسارات API من الكاش الثابت وتطبيق استراتيجية Network-First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({
              success: false,
              data: null,
              error: 'لا يوجد اتصال بالإنترنت حالياً.',
            }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' },
            }
          )
      )
    );
    return;
  }

  // فقط للطلبات داخل نفس الأصل (App Shell وملفات الواجهة)
  if (url.origin !== self.location.origin) {
    return;
  }

  // استثناء ملفات التطوير في Vite وملف Service Worker نفسه لتجنب تعارض النسخ
  if (
    url.pathname === '/sw.js' ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname === '/__vite_ping' ||
    url.searchParams.has('v') ||
    url.searchParams.has('t')
  ) {
    return;
  }

  // تنقلات الصفحات: Network-First مع الرجوع إلى App Shell المخزّن عند انقطاع الشبكة
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match('/')
            .then((cached) => cached || caches.match('/index.html'))
        )
    );
    return;
  }

  // حزم الإنتاج المجزّأة والأيقونات الثابتة: Cache-First
  if (
    url.pathname.startsWith('/assets/') ||
    STATIC_IMAGE_PATHS.has(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) return cachedResponse;
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.ok) {
            const copy = networkResponse.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // بقية الملفات الثابتة (مثل manifest.json): Network-First
  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return networkResponse;
      })
      .catch(() => caches.match(request))
  );
});

self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const title = payload.title || 'وصال الجامعي';
  const body =
    payload.body ||
    payload.message ||
    'لديك تحديث جديد على بلاغك في مكتب شؤون الطلاب.';
  const tag = payload.tag || 'wisal-report-update';
  const targetUrl = payload.url || '/?tab=my-reports';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200],
      dir: 'rtl',
      lang: 'ar',
      tag,
      renotify: true,
      data: {
        url: targetUrl,
        reportId: payload.reportId || null,
        reportCode: payload.reportCode || null,
      },
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_WISAL_NOTIFICATION') {
    const payload = event.data.payload || {};
    const title = payload.title || 'وصال الجامعي';
    const body = payload.body || '';
    event.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/pwa-192x192.png',
        badge: '/pwa-192x192.png',
        vibrate: [200, 100, 200],
        dir: 'rtl',
        lang: 'ar',
        tag: payload.tag || 'wisal-report-update',
        renotify: true,
        data: {
          url: '/?tab=my-reports',
          reportId: payload.reportId || null,
          reportCode: payload.reportCode || null,
        },
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) ||
    '/?tab=my-reports';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({
              type: 'OPEN_MY_REPORTS',
              reportId: event.notification.data?.reportId || null,
              reportCode: event.notification.data?.reportCode || null,
            });
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return undefined;
      })
  );
});
