self.addEventListener('push', (event) => {
    let data = { title: 'Workspace Update Alert', body: 'Asynchronous event data modification observed.' };
    if (event.data) {
        try { data = event.data.json(); } 
        catch (e) { data = { title: 'Workspace Update Alert', body: event.data.text() }; }
    }
    const options = {
        body: data.body,
        icon: '/icon.png',
        badge: '/badge.png',
        data: { taskId: data.taskId },
        vibrate: [100, 50, 100],
        actions: [{ action: 'open', title: 'Open Document Canvas' }]
    };
    event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === '/' && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow('/');
        })
    );
});