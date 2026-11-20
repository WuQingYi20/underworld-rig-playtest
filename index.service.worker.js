// Replaces Godot's index.service.worker.js after export (scripts/export_web.sh).
// Godot's worker answers from its cache first, so after an update players kept
// getting the old build until every tab was closed. This one always asks the
// network (a cheap revalidation when nothing changed) and only falls back to
// the offline page. It takes over at once (skipWaiting + claim); the loading
// page (export/web_shell.html) reloads once when a new worker takes over.
// It still adds the COOP/COEP headers that hosts like GitHub Pages cannot send,
// which the threaded build needs.
const CACHE_NAME = 'yinjian-offline-v1';
const OFFLINE_URL = 'index.offline.html';

self.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE_NAME)
		.then((cache) => cache.add(OFFLINE_URL))
		.catch(() => {})
		.then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
	// drop Godot's old caches (they held stale builds)
	event.waitUntil(caches.keys()
		.then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
		.then(() => (self.registration.navigationPreload ? self.registration.navigationPreload.disable() : null))
		.then(() => self.clients.claim()));
});

function isolate(response) {
	if (response.type === 'opaque' || response.type === 'opaqueredirect') {
		return response;
	}
	if (response.headers.get('Cross-Origin-Embedder-Policy') === 'require-corp'
		&& response.headers.get('Cross-Origin-Opener-Policy') === 'same-origin') {
		return response;
	}
	const headers = new Headers(response.headers);
	headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) {
		return;   // telemetry posts and anything cross-origin go straight through
	}
	const nav = req.mode === 'navigate';
	event.respondWith((async () => {
		try {
			// always revalidate, past the HTTP cache too (GitHub Pages sends max-age=600);
			// a navigation request cannot take an init, so pages are fetched by URL
			const response = nav
				? await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
				: await fetch(req, { cache: 'no-cache' });
			return isolate(response);
		} catch (err) {
			if (nav) {
				const offline = await caches.match(OFFLINE_URL);
				if (offline) {
					return isolate(offline);
				}
			}
			throw err;
		}
	})());
});
