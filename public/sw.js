/* Minimal service worker: makes the site installable and lets alerts use system notifications on phones.
   It does not cache pages (scores must always be fresh). */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function () { /* network only */ });
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (cs) { for (var i = 0; i < cs.length; i++) { if ('focus' in cs[i]) return cs[i].focus(); } return self.clients.openWindow(url); }));
});
