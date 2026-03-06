self.addEventListener('install', (event) => {
    console.log('Service Worker geïnstalleerd');
});

self.addEventListener('fetch', (event) => {
    // Dit is nodig om de browser te laten denken dat de app offline kan werken
});
