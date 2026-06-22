self.addEventListener('push', (event) => {
    event.waitUntil(self.registration.showNotification("Update", { body: "Data refreshed", icon: '/icon.png' }));
});