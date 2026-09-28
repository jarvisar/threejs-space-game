// Service worker registration, the install button and the update notice. The
// service worker only exists in production builds.

let installEvent = null;
let waiting = null;
let reloading = false;
let onChange = () => {};

export const canInstall = () => !!installEvent;
export const updateReady = () => !!waiting;

export function onPwaChange(fn) {
  onChange = fn;
}

export function promptInstall() {
  if (!installEvent) return;
  installEvent.prompt();
  installEvent = null;
  onChange();
}

export function applyUpdate() {
  if (!waiting) return;
  reloading = true;
  waiting.postMessage('skip-waiting');
}

export function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    // keep the browser's own install bar off the game, the title screen has a button
    e.preventDefault();
    installEvent = e;
    onChange();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    onChange();
  });
  // an installed app can ask for storage the browser won't clear on its own, which keeps the save safe
  if (matchMedia('(display-mode: standalone)').matches) navigator.storage?.persist?.().catch(() => {});
}

// Called once the title screen is up. Installing the worker downloads the
// whole build again for the cache, which we don't want competing with the
// first load for bandwidth.
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const found = (w) => {
        // no controller yet means this is the first install, not an update
        if (!w || !navigator.serviceWorker.controller) return;
        waiting = w;
        onChange();
      };
      found(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => {
          if (w.state === 'installed') found(w);
        });
      });
    })
    .catch(() => {});
}
