import './style.css';
import { Game } from './core/Game';

/**
 * Bootstrap: shows a loading panel while the WASM physics engine initialises,
 * then hands control to the Game (which opens on the main menu).
 */
async function main() {
  const app = document.getElementById('app')!;

  const loading = document.createElement('div');
  loading.id = 'loading';
  loading.innerHTML = `
    <div class="txt">LOADING ARENA…</div>
    <div class="bar"><div></div></div>
  `;
  app.appendChild(loading);

  try {
    await Game.create(app);
  } catch (err) {
    loading.innerHTML = `<div class="txt" style="color:#ff3b3b">FAILED TO START</div>`;
    console.error(err);
    return;
  }
  loading.remove();
}

main();
