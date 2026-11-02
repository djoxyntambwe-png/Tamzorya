// Tamzorya — sw.js : garde une copie de l'application pour l'ouvrir même sans réseau
const C = 'tamzorya-v043';
const FICHIERS = ['./', './index.html', './styles.css?v=043', './app.js?v=043',
  './core-ia.js?v=043', './prompt-commercant.js?v=043', './prompt-prestataire.js?v=043',
  './manifest.json', './icon-192.png', './apple-touch-icon.png', './favicon-48.png', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2'];
self.addEventListener('install', e => e.waitUntil(
  caches.open(C).then(c => Promise.all(FICHIERS.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.hostname.endsWith('supabase.co')) return;
  if (u.origin !== location.origin && !u.hostname.includes('jsdelivr')) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const k = r.clone(); caches.open(C).then(c => c.put(e.request, k)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
