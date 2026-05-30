import './style.css';
import { Game } from './core/Game';
import { initInstall } from './ui/InstallPrompt';

/**
 * Bootstrap: shows a loading panel while the WASM physics engine initialises,
 * then hands control to the Game (which opens on the main menu).
 */
async function main() {
  const app = document.getElementById('app')!;

  // Register the service worker and start listening for the install prompt
  // before anything else, so a fast-firing `beforeinstallprompt` isn't missed.
  initInstall();

  const loading = document.createElement('div');
  loading.id = 'loading';
  loading.innerHTML = `
    <div class="txt">LOADING ARENA…</div>
    <div class="bar"><div></div></div>
  `;
  app.appendChild(loading);

  let game;
  try {
    game = await Game.create(app);
  } catch (err) {
    loading.innerHTML = `<div class="txt" style="color:#ff3b3b">FAILED TO START</div>`;
    console.error(err);
    return;
  }
  loading.remove();

  // An invite link (?room=CODE) jumps straight to the join screen.
  const code = new URLSearchParams(location.search).get('room');
  if (code) game.menu.openJoinWithCode(code.toUpperCase());
}

main();
