'use strict';

function isLocalDevHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

async function disableLocalServiceWorker() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister().catch(() => false)));
  } catch (_err) {
    // Ignore cleanup failures in development.
  }

  if (!('caches' in window)) {
    return;
  }
  try {
    const keys = await window.caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith('mygame-shell-'))
        .map((key) => window.caches.delete(key).catch(() => false))
    );
  } catch (_err) {
    // Ignore cache cleanup failures in development.
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      if (isLocalDevHost(window.location.hostname)) {
        await disableLocalServiceWorker();
        return;
      }
      await navigator.serviceWorker.register('./service-worker.js?v=20260824112338', { scope: './' });
    } catch (_err) {
      // PWA registration failures should not block app usage.
    }
  });
}
