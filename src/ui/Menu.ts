import type { Actor } from '../entities/Actor';
import type { MatchConfig } from '../core/types';

export interface GameSettings {
  sensitivity: number;
  volume: number;
  fov: number;
}

export interface MenuHandlers {
  onStart: (config: MatchConfig) => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onConnectOnline: (url: string, name: string) => void;
  settings: GameSettings;
}

/** Front-end screens: main menu, pause overlay and match-over screen. */
export class Menu {
  private container: HTMLDivElement;
  private h: MenuHandlers;

  // match setup state
  private botCount = 4;
  private fragLimit = 20;
  private difficulty: MatchConfig['difficulty'] = 'skilled';
  private playerName = 'PLAYER';
  private serverUrl = 'ws://localhost:2567';

  constructor(parent: HTMLElement, handlers: MenuHandlers) {
    this.h = handlers;
    this.container = document.createElement('div');
    parent.appendChild(this.container);
    this.showMain();
  }

  private clear() { this.container.innerHTML = ''; }
  hideAll() { this.clear(); }

  // ---- main menu ------------------------------------------------------

  showMain() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo">FRAG&nbsp;<span class="x">PROTOCOL</span></div>
      <div class="tag">Browser Arena Combat</div>
      <div class="menu-card">
        <h3>Instant Action — Deathmatch</h3>
        <div class="field">
          <label>Opponents</label>
          <input type="range" id="m-bots" min="1" max="7" step="1" value="${this.botCount}">
          <span class="val" id="m-bots-v">${this.botCount}</span>
        </div>
        <div class="field">
          <label>Frag limit</label>
          <input type="range" id="m-frags" min="5" max="50" step="5" value="${this.fragLimit}">
          <span class="val" id="m-frags-v">${this.fragLimit}</span>
        </div>
        <div class="field">
          <label>Difficulty</label>
          <div class="seg" id="m-diff">
            <button data-d="rookie">Rookie</button>
            <button data-d="skilled">Skilled</button>
            <button data-d="deadly">Deadly</button>
          </div>
        </div>
        <div class="field">
          <label>Mouse sensitivity</label>
          <input type="range" id="m-sens" min="0.2" max="3" step="0.1" value="${this.h.settings.sensitivity}">
          <span class="val" id="m-sens-v">${this.h.settings.sensitivity.toFixed(1)}</span>
        </div>
        <div class="field">
          <label>Volume</label>
          <input type="range" id="m-vol" min="0" max="1" step="0.05" value="${this.h.settings.volume}">
          <span class="val" id="m-vol-v">${Math.round(this.h.settings.volume * 100)}</span>
        </div>
        <div class="btn-row">
          <button class="primary" id="m-start">Enter Arena</button>
          <button id="m-online">Play Online</button>
          <button id="m-credits">Credits</button>
        </div>
      </div>
      <div class="help">
        <b>WASD</b> move &nbsp; <b>SPACE</b> jump (double-jump) &nbsp; <b>double-tap</b> a key to dodge<br>
        <b>MOUSE</b> aim &nbsp; <b>L-CLICK</b> fire &nbsp; <b>R-CLICK</b> alt-fire &nbsp;
        <b>1-4 / wheel</b> weapons &nbsp; <b>TAB</b> scores &nbsp; <b>ESC</b> pause
      </div>
      <div class="credits">
        An original arena shooter — a homage to early-2000s tournament FPS, not affiliated with any
        existing game. Built with Three.js + Rapier. All geometry, effects and audio are generated
        procedurally; no third-party assets are bundled.
      </div>
    `;
    this.container.appendChild(s);

    const bots = s.querySelector('#m-bots') as HTMLInputElement;
    const botsV = s.querySelector('#m-bots-v')!;
    bots.oninput = () => { this.botCount = +bots.value; botsV.textContent = bots.value; };

    const frags = s.querySelector('#m-frags') as HTMLInputElement;
    const fragsV = s.querySelector('#m-frags-v')!;
    frags.oninput = () => { this.fragLimit = +frags.value; fragsV.textContent = frags.value; };

    const sens = s.querySelector('#m-sens') as HTMLInputElement;
    const sensV = s.querySelector('#m-sens-v')!;
    sens.oninput = () => {
      this.h.settings.sensitivity = +sens.value;
      sensV.textContent = (+sens.value).toFixed(1);
    };

    const vol = s.querySelector('#m-vol') as HTMLInputElement;
    const volV = s.querySelector('#m-vol-v')!;
    vol.oninput = () => {
      this.h.settings.volume = +vol.value;
      volV.textContent = String(Math.round(+vol.value * 100));
    };

    const diff = s.querySelector('#m-diff')!;
    const paintDiff = () => diff.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', (b as HTMLElement).dataset.d === this.difficulty);
    });
    diff.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        this.difficulty = (b as HTMLElement).dataset.d as MatchConfig['difficulty'];
        paintDiff();
      });
    });
    paintDiff();

    (s.querySelector('#m-start') as HTMLButtonElement).onclick = () => {
      this.h.onStart({
        botCount: this.botCount,
        fragLimit: this.fragLimit,
        timeLimitSec: 600,
        difficulty: this.difficulty,
      });
    };
    (s.querySelector('#m-online') as HTMLButtonElement).onclick = () => this.showOnline();
    (s.querySelector('#m-credits') as HTMLButtonElement).onclick = () => this.showCredits();
  }

  // ---- online ---------------------------------------------------------

  showConnecting() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:44px;">CONNECTING…</div>
      <div class="tag">reaching the server</div>
      <div id="loading" style="position:relative;inset:auto;background:none;">
        <div class="bar"><div></div></div>
      </div>
    `;
    this.container.appendChild(s);
  }

  showOnline(error?: string) {
    this.clear();
    const inputStyle =
      'background:#0d1623;border:1px solid var(--accent-dim);color:var(--text);' +
      'padding:7px 10px;font-family:inherit;font-size:14px;width:230px;';
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:46px;">PLAY <span class="x">ONLINE</span></div>
      <div class="tag">Online Deathmatch</div>
      <div class="menu-card" style="min-width:440px;">
        <h3>Connect to a Server</h3>
        <div class="field">
          <label>Callsign</label>
          <input type="text" id="o-name" maxlength="14" value="${this.playerName}" style="${inputStyle}">
        </div>
        <div class="field">
          <label>Server</label>
          <input type="text" id="o-url" value="${this.serverUrl}" style="${inputStyle}">
        </div>
        ${error ? `<div style="color:var(--danger);font-size:13px;letter-spacing:1px;` +
          `text-align:center;margin-top:8px;">⚠ ${error}</div>` : ''}
        <div class="btn-row">
          <button class="primary" id="o-connect">Connect</button>
          <button id="o-back">Back</button>
        </div>
      </div>
      <div class="help">
        Start the server first: <b>cd server</b> &nbsp;·&nbsp; <b>npm install</b>
        &nbsp;·&nbsp; <b>npm start</b><br>
        then connect to <b>ws://localhost:2567</b>. Players-only deathmatch — no bots.
      </div>
    `;
    this.container.appendChild(s);

    const nameEl = s.querySelector('#o-name') as HTMLInputElement;
    const urlEl = s.querySelector('#o-url') as HTMLInputElement;
    (s.querySelector('#o-connect') as HTMLButtonElement).onclick = () => {
      this.playerName = (nameEl.value.trim() || 'PLAYER').slice(0, 14);
      this.serverUrl = urlEl.value.trim() || 'ws://localhost:2567';
      this.h.onConnectOnline(this.serverUrl, this.playerName);
    };
    (s.querySelector('#o-back') as HTMLButtonElement).onclick = () => this.showMain();
  }

  // ---- credits --------------------------------------------------------

  showCredits() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:46px;">CREDITS</div>
      <div class="menu-card" style="min-width:540px;">
        <h3>Frag Protocol</h3>
        <div class="help" style="margin-top:0;text-align:left;line-height:2.1;">
          An original browser arena FPS — a homage to early-2000s tournament
          shooters. <b>Not affiliated with Epic Games or Unreal Tournament</b>;
          it ships none of that game's code, engine or assets.<br><br>
          <b>Engine</b> &nbsp; Three.js (MIT) · Rapier physics (Apache-2.0)<br>
          <b>Character model</b> &nbsp; "RobotExpressive" by Tomás Laulhé,
          modified by Don McCurdy — CC0 / public domain<br>
          <b>Everything else</b> &nbsp; all geometry, textures, sound effects
          and the announcer voice are generated procedurally at runtime —
          no other third-party assets are bundled.
        </div>
        <div class="btn-row">
          <button class="primary" id="c-back">Back</button>
        </div>
      </div>
    `;
    this.container.appendChild(s);
    (s.querySelector('#c-back') as HTMLButtonElement).onclick = () => this.showMain();
  }

  // ---- pause ----------------------------------------------------------

  showPause() {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:48px;">PAUSED</div>
      <div class="menu-card" style="min-width:360px;">
        <h3>Match Paused</h3>
        <div class="field">
          <label>Mouse sensitivity</label>
          <input type="range" id="p-sens" min="0.2" max="3" step="0.1" value="${this.h.settings.sensitivity}">
          <span class="val" id="p-sens-v">${this.h.settings.sensitivity.toFixed(1)}</span>
        </div>
        <div class="field">
          <label>Volume</label>
          <input type="range" id="p-vol" min="0" max="1" step="0.05" value="${this.h.settings.volume}">
          <span class="val" id="p-vol-v">${Math.round(this.h.settings.volume * 100)}</span>
        </div>
        <div class="btn-row">
          <button class="primary" id="p-resume">Resume</button>
          <button id="p-restart">Restart</button>
          <button id="p-menu">Main Menu</button>
        </div>
      </div>
      <div class="help">Click <b>Resume</b> or press <b>ESC</b> to get back in the fight.</div>
    `;
    this.container.appendChild(s);

    const sens = s.querySelector('#p-sens') as HTMLInputElement;
    const sensV = s.querySelector('#p-sens-v')!;
    sens.oninput = () => {
      this.h.settings.sensitivity = +sens.value;
      sensV.textContent = (+sens.value).toFixed(1);
    };
    const vol = s.querySelector('#p-vol') as HTMLInputElement;
    const volV = s.querySelector('#p-vol-v')!;
    vol.oninput = () => {
      this.h.settings.volume = +vol.value;
      volV.textContent = String(Math.round(+vol.value * 100));
    };
    (s.querySelector('#p-resume') as HTMLButtonElement).onclick = () => this.h.onResume();
    (s.querySelector('#p-restart') as HTMLButtonElement).onclick = () => this.h.onRestart();
    (s.querySelector('#p-menu') as HTMLButtonElement).onclick = () => this.h.onMainMenu();
  }

  // ---- match over -----------------------------------------------------

  showEnd(ranking: Actor[], winner: Actor | null, localPlayer: Actor) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const won = winner === localPlayer;
    const rows = ranking.map((a, i) => {
      const cls = a === localPlayer ? 'sb-row me' : 'sb-row';
      return `<div class="${cls}"><div>${i + 1}. ${a.name}</div>` +
        `<div class="c">${a.frags}</div><div class="c">${a.deaths}</div>` +
        `<div class="c">${a.frags - a.deaths}</div></div>`;
    }).join('');
    s.innerHTML = `
      <div class="logo" style="font-size:52px;color:${won ? '#6dff8a' : '#ff7a18'};">
        ${won ? 'VICTORY' : 'MATCH OVER'}
      </div>
      <div class="tag">${winner ? `${winner.name} wins the match` : 'Match complete'}</div>
      <div id="scoreboard" style="position:relative;transform:none;left:auto;top:auto;">
        <h2>Final Standings</h2>
        <div class="sb-row head"><div>PLAYER</div><div class="c">FRAGS</div>
          <div class="c">DEATHS</div><div class="c">SCORE</div></div>
        ${rows}
      </div>
      <div class="btn-row">
        <button class="primary" id="e-again">Play Again</button>
        <button id="e-menu">Main Menu</button>
      </div>
    `;
    this.container.appendChild(s);
    (s.querySelector('#e-again') as HTMLButtonElement).onclick = () => this.h.onRestart();
    (s.querySelector('#e-menu') as HTMLButtonElement).onclick = () => this.h.onMainMenu();
  }
}
