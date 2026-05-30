/**
 * Progressive Web App install handling.
 *
 * Two jobs:
 *  - Register the service worker (production builds only — see `initInstall`).
 *  - Offer an "install to home screen" button, but *only* on phones/tablets:
 *    desktop browsers and already-installed app windows never see it.
 *
 * Install works very differently per platform:
 *  - Chromium (Android Chrome/Edge/Samsung): fires `beforeinstallprompt`, which
 *    we stash and replay on a user gesture — a true one-tap native install.
 *  - iOS Safari: has no install API at all. The only path is the Share sheet,
 *    so the button opens a small how-to instead.
 *  - Anything else (e.g. Firefox Android): falls back to the same how-to,
 *    pointing at the browser menu.
 *
 * A single shared button element is owned by this module and re-parented by
 * `mountInstallButton`, so the async `beforeinstallprompt` event (which can
 * arrive before or after a menu is built) always updates the live button.
 */
import { isTouchDevice } from '../core/device';

/** The non-standard Chromium event we capture to drive a native install. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installed = false;
let button: HTMLButtonElement | null = null;
let wired = false;

/** Running inside an installed (standalone) app window rather than a tab. */
function isStandalone(): boolean {
  const mm = window.matchMedia;
  return (
    (typeof mm === 'function' &&
      (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches)) ||
    // iOS Safari marks home-screen launches with this legacy flag.
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iOS / iPadOS Safari — needs the manual Share-sheet flow. */
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as desktop Mac but has a touch screen.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Show/hide and relabel the shared button for the current state. */
function render() {
  if (!button) return;
  const show = isTouchDevice() && !isStandalone() && !installed;
  button.style.display = show ? '' : 'none';
  button.textContent = isIOS() ? '⬇  Add to Home Screen' : '⬇  Install App';
}

/**
 * Wire global install listeners and register the service worker. Safe to call
 * more than once; only the first call takes effect. Call as early as possible
 * so the `beforeinstallprompt` event is never missed.
 */
export function initInstall() {
  if (wired) return;
  wired = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    // Stop Chrome's default mini-infobar; we drive the prompt from our button.
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferredPrompt = null;
    render();
  });

  // Register the service worker (required for the install prompt + offline).
  // Dev only skips it so Vite's HMR isn't shadowed by a cache.
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => {
        console.warn('[pwa] service worker registration failed', err);
      });
    });
  }
}

/**
 * Place the install button inside `parent`. No-op on non-touch devices and in
 * installed app windows. The same element moves between menus on each call.
 */
export function mountInstallButton(parent: HTMLElement) {
  initInstall();
  if (!isTouchDevice() || isStandalone()) return;

  if (!button) {
    button = document.createElement('button');
    button.className = 'install-btn';
    button.addEventListener('click', onInstallClick);
  }
  parent.appendChild(button);
  render();
}

async function onInstallClick() {
  if (!button || installed || isStandalone()) return;

  if (deferredPrompt) {
    button.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch {
      /* user dismissed or prompt unavailable — nothing to do */
    }
    // A prompt can only be used once; drop it and let `appinstalled` hide us.
    deferredPrompt = null;
    button.disabled = false;
    render();
    return;
  }

  // No native prompt available — guide the user through the manual flow.
  showHowTo();
}

/** A small instructional sheet for platforms without a one-tap install. */
function showHowTo() {
  const overlay = document.createElement('div');
  overlay.className = 'install-sheet';

  const steps = isIOS()
    ? `<ol>
         <li>Tap the <b>Share</b> button
           <span class="ish-glyph">${shareGlyph()}</span> in the Safari toolbar.</li>
         <li>Scroll down and tap <b>Add to Home Screen</b>.</li>
         <li>Tap <b>Add</b> — Frag Protocol lands on your home screen.</li>
       </ol>`
    : `<ol>
         <li>Open your browser's menu <b>(⋮)</b>.</li>
         <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
         <li>Confirm — the game installs like a native app.</li>
       </ol>`;

  overlay.innerHTML = `
    <div class="install-card">
      <div class="install-title">Install Frag Protocol</div>
      <div class="install-body">${steps}</div>
      <button class="install-close">Got it</button>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('.install-close')!.addEventListener('click', close);
  document.body.appendChild(overlay);
}

/** Inline SVG of the iOS share icon (a box with an up-arrow). */
function shareGlyph(): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 3v12M8 7l4-4 4 4"/>
    <path d="M6 12H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2h-1"/>
  </svg>`;
}
