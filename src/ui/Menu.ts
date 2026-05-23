import * as THREE from 'three';
import type { Actor } from '../entities/Actor';
import type { MatchConfig, GameMode, Team } from '../core/types';
import type { CashRaidRules } from '../game/CashRaidRules';
import type { LobbyConfig, LobbyState } from '../net/protocol';
import { teamName } from '../game/teams';
import {
  CHARACTERS, loadCharacter, createCharacter, isCharacterAvailable,
  type CharacterInstance,
} from '../core/Models';
import { mapsForMode, DEFAULT_MAP } from '../arena/MapRegistry';

/** Cash Raid economy defaults used for offline / instant-action matches. */
export const CASHRAID_START_MONEY = 20000;
export const CASHRAID_WIN_TARGET = 100000;

export interface GameSettings {
  sensitivity: number;
  volume: number;
  fov: number;
  /**
   * 'fast' — disables bloom, drops shadow resolution, caps pixel ratio at
   *          1.25, and skips shadows on bot/remote characters. Aimed at
   *          consistent 60+ FPS on mid-range hardware.
   * 'high' — restores the original bloom + 2k shadow look.
   */
  quality: 'fast' | 'high';
}

export interface MenuHandlers {
  onStart: (config: MatchConfig) => void;
  onResume: () => void;
  onRestart: () => void;
  onMainMenu: () => void;
  onCreateRoom: (url: string, name: string, config: LobbyConfig) => void;
  onJoinRoom: (url: string, name: string, code: string) => void;
  onLeaveRoom: () => void;
  onLobbyReady: (ready: boolean) => void;
  onLobbySelectTeam: (team: 1 | 2) => void;
  onLobbyConfig: (config: LobbyConfig) => void;
  onLobbyKick: (id: number) => void;
  onLobbyStart: () => void;
  /** Called when the player commits a character pick on the select screen. */
  onCharacter: (id: string) => void;
  /** Read the player's current character id (for hydrating the select UI). */
  getCharacter: () => string;
  /** Save a new graphics-quality choice (takes effect on next page load). */
  onQuality: (q: GameSettings['quality']) => void;
  settings: GameSettings;
}

/** Default lobby configuration used to seed the create-room form. */
function defaultLobbyConfig(): LobbyConfig {
  return {
    mode: 'cashraid', maxPlayers: 8, durationSec: 900, botCount: 4,
    fragLimit: 25, difficulty: 'skilled', startMoney: 20000,
    winTarget: 100000, isPublic: true, mapId: DEFAULT_MAP.cashraid,
  };
}

/** Front-end screens: main menu, pause overlay and match-over screen. */
export class Menu {
  private container: HTMLDivElement;
  private h: MenuHandlers;

  // match setup state
  private mode: GameMode = 'deathmatch';
  private botCount = 4;
  private fragLimit = 20;
  private difficulty: MatchConfig['difficulty'] = 'skilled';
  /** Last-chosen map per mode, remembered while the menu is open. */
  private mapByMode: Record<GameMode, string> = {
    deathmatch: DEFAULT_MAP.deathmatch,
    cashraid: DEFAULT_MAP.cashraid,
  };
  private playerName = 'PLAYER';
  private serverUrl = (import.meta.env.VITE_WS_URL as string) || 'ws://localhost:2567';
  private lobbyCfg: LobbyConfig = defaultLobbyConfig();

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
        <h3>Instant Action</h3>
        <div class="field">
          <label>Game mode</label>
          <div class="seg" id="m-mode">
            <button data-m="deathmatch">Deathmatch</button>
            <button data-m="cashraid">Cash Raid</button>
          </div>
        </div>
        <div class="field" id="m-map-field">
          <label>Map</label>
          <select id="m-map" class="menu-select"></select>
        </div>
        <div class="field">
          <label>Opponents</label>
          <input type="range" id="m-bots" min="1" max="7" step="1" value="${this.botCount}">
          <span class="val" id="m-bots-v">${this.botCount}</span>
        </div>
        <div class="field" id="m-frags-field">
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
          <button id="m-character">Character</button>
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

    const modeSeg = s.querySelector('#m-mode')!;
    const fragsField = s.querySelector('#m-frags-field') as HTMLElement;
    const mapField = s.querySelector('#m-map-field') as HTMLElement;
    const mapSel = s.querySelector('#m-map') as HTMLSelectElement;
    const startBtn = s.querySelector('#m-start') as HTMLButtonElement;

    const refreshMaps = () => {
      const maps = mapsForMode(this.mode);
      mapSel.innerHTML = maps
        .map((m) => `<option value="${m.id}" title="${m.description}">${m.name}</option>`)
        .join('');
      // If our remembered pick isn't valid for this mode, fall back to default.
      if (!maps.some((m) => m.id === this.mapByMode[this.mode])) {
        this.mapByMode[this.mode] = DEFAULT_MAP[this.mode];
      }
      mapSel.value = this.mapByMode[this.mode];
      // Hide the field if there's only one option.
      mapField.style.display = maps.length > 1 ? '' : 'none';
    };
    mapSel.onchange = () => { this.mapByMode[this.mode] = mapSel.value; };

    const paintMode = () => {
      modeSeg.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('on', (b as HTMLElement).dataset.m === this.mode);
      });
      // frag limit is meaningless in Cash Raid
      fragsField.style.display = this.mode === 'cashraid' ? 'none' : '';
      startBtn.textContent = this.mode === 'cashraid' ? 'Raid' : 'Enter Arena';
      refreshMaps();
    };
    modeSeg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        this.mode = (b as HTMLElement).dataset.m as GameMode;
        paintMode();
      });
    });
    paintMode();

    startBtn.onclick = () => {
      const cfg: MatchConfig = {
        mode: this.mode,
        botCount: this.botCount,
        fragLimit: this.fragLimit,
        timeLimitSec: this.mode === 'cashraid' ? 900 : 600,
        difficulty: this.difficulty,
        mapId: this.mapByMode[this.mode],
      };
      if (this.mode === 'cashraid') {
        cfg.startMoney = CASHRAID_START_MONEY;
        cfg.winTarget = CASHRAID_WIN_TARGET;
      }
      this.h.onStart(cfg);
    };
    (s.querySelector('#m-online') as HTMLButtonElement).onclick = () => this.showOnlineHub();
    (s.querySelector('#m-character') as HTMLButtonElement).onclick = () => this.showCharacterSelect();
    (s.querySelector('#m-credits') as HTMLButtonElement).onclick = () => this.showCredits();
  }

  // ---- character select ----------------------------------------------

  /** Cleanup callback installed by the character-select preview. */
  private characterSelectCleanup: (() => void) | null = null;

  showCharacterSelect() {
    this.disposeCharacterSelect();
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const current = this.h.getCharacter();

    const listHtml = CHARACTERS.map((c) => `
      <button class="cs-item${c.id === current ? ' on' : ''}" data-cs="${c.id}">
        <div class="cs-name">${c.name}</div>
        <div class="cs-desc">${c.description}</div>
      </button>
    `).join('');

    s.innerHTML = `
      <div class="logo" style="font-size:46px;">CHOOSE <span class="x">YOUR FIGHTER</span></div>
      <div class="tag">Free CC0 characters — swap any time from the main menu</div>
      <div class="cs-wrap">
        <div class="cs-list">${listHtml}</div>
        <div class="cs-stage">
          <canvas id="cs-canvas" width="420" height="520"></canvas>
          <div class="cs-info">
            <div class="cs-info-name" id="cs-info-name"></div>
            <div class="cs-info-desc" id="cs-info-desc"></div>
            <div class="cs-info-status" id="cs-info-status"></div>
          </div>
        </div>
      </div>
      <div class="btn-row">
        <button class="primary" id="cs-confirm">Confirm</button>
        <button id="cs-back">Back</button>
      </div>
      <div class="help" style="margin-top:8px;">
        Missing models? Drop GLB files into <b>public/models/characters/</b> —
        see <b>public/models/characters/README.md</b>.
      </div>
    `;
    this.container.appendChild(s);

    const canvas = s.querySelector('#cs-canvas') as HTMLCanvasElement;
    const infoName = s.querySelector('#cs-info-name') as HTMLElement;
    const infoDesc = s.querySelector('#cs-info-desc') as HTMLElement;
    const infoStatus = s.querySelector('#cs-info-status') as HTMLElement;
    const preview = new CharacterPreview(canvas);
    let selected = current;

    const paintList = () => {
      s.querySelectorAll('.cs-item').forEach((b) => {
        b.classList.toggle('on', (b as HTMLElement).dataset.cs === selected);
      });
    };

    const pick = async (id: string) => {
      selected = id;
      const def = CHARACTERS.find((c) => c.id === id)!;
      infoName.textContent = def.name;
      infoDesc.textContent = def.description;
      infoStatus.textContent = 'loading…';
      paintList();
      await loadCharacter(id);
      const ok = isCharacterAvailable(id);
      infoStatus.textContent = ok ? '' :
        'Model file not found — using the Sentinel as a stand-in. Drop the GLB into public/models/characters/ to enable.';
      infoStatus.style.color = ok ? '' : '#ffb84d';
      preview.show(id);
    };

    s.querySelectorAll('.cs-item').forEach((b) => {
      b.addEventListener('click', () => pick((b as HTMLElement).dataset.cs!));
    });
    (s.querySelector('#cs-confirm') as HTMLButtonElement).onclick = () => {
      this.h.onCharacter(selected);
      this.disposeCharacterSelect();
      this.showMain();
    };
    (s.querySelector('#cs-back') as HTMLButtonElement).onclick = () => {
      this.disposeCharacterSelect();
      this.showMain();
    };

    this.characterSelectCleanup = () => preview.dispose();
    pick(current);
  }

  private disposeCharacterSelect() {
    if (this.characterSelectCleanup) {
      this.characterSelectCleanup();
      this.characterSelectCleanup = null;
    }
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

  private readonly inputCss =
    'background:#0d1623;border:1px solid var(--accent-dim);color:var(--text);' +
    'padding:7px 10px;font-family:inherit;font-size:14px;width:230px;';

  /** Jump straight to the join screen with a code (used by invite links). */
  openJoinWithCode(code: string) { this.showJoinRoom(code); }

  /** Online hub: pick create-room or join-room. */
  showOnlineHub(error?: string) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:46px;">PLAY <span class="x">ONLINE</span></div>
      <div class="tag">Rooms · Invite Codes · Cash Raid</div>
      <div class="menu-card" style="min-width:440px;">
        <h3>Online Play</h3>
        <div class="field"><label>Callsign</label>
          <input type="text" id="o-name" maxlength="14" value="${this.playerName}" style="${this.inputCss}"></div>
        <div class="field"><label>Server</label>
          <input type="text" id="o-url" value="${this.serverUrl}" style="${this.inputCss}"></div>
        ${error ? `<div class="form-error">⚠ ${error}</div>` : ''}
        <div class="btn-row">
          <button class="primary" id="o-create">Create Room</button>
          <button id="o-join">Join Room</button>
          <button id="o-back">Back</button>
        </div>
      </div>
      <div class="help">Run a server: <b>cd server</b> &nbsp;·&nbsp; <b>npm install</b>
        &nbsp;·&nbsp; <b>npm start</b></div>
    `;
    this.container.appendChild(s);
    const grab = () => {
      this.playerName = ((s.querySelector('#o-name') as HTMLInputElement).value.trim() || 'PLAYER').slice(0, 14);
      this.serverUrl = (s.querySelector('#o-url') as HTMLInputElement).value.trim() || this.serverUrl;
    };
    (s.querySelector('#o-create') as HTMLButtonElement).onclick = () => { grab(); this.showCreateRoom(); };
    (s.querySelector('#o-join') as HTMLButtonElement).onclick = () => { grab(); this.showJoinRoom(); };
    (s.querySelector('#o-back') as HTMLButtonElement).onclick = () => this.showMain();
  }

  /** Settings fields shared by the create-room form. */
  private configFields(cfg: LobbyConfig): string {
    const min = Math.round(cfg.durationSec / 60);
    return `
      <div class="field"><label>Mode</label>
        <div class="seg" id="c-mode">
          <button data-m="cashraid">Cash Raid</button>
          <button data-m="deathmatch">Deathmatch</button>
        </div></div>
      <div class="field" id="c-map-field"><label>Map</label>
        <select id="c-map" class="menu-select"></select></div>
      <div class="field"><label>Max players</label>
        <input type="range" id="c-max" min="2" max="12" step="1" value="${cfg.maxPlayers}">
        <span class="val" id="c-max-v">${cfg.maxPlayers}</span></div>
      <div class="field"><label>Bots</label>
        <input type="range" id="c-bots" min="0" max="10" step="1" value="${cfg.botCount}">
        <span class="val" id="c-bots-v">${cfg.botCount}</span></div>
      <div class="field"><label>Duration (min)</label>
        <input type="range" id="c-dur" min="3" max="20" step="1" value="${min}">
        <span class="val" id="c-dur-v">${min}</span></div>
      <div class="field cr-only"><label>Win target ($k)</label>
        <input type="range" id="c-target" min="20" max="500" step="10" value="${cfg.winTarget / 1000}">
        <span class="val" id="c-target-v">${cfg.winTarget / 1000}</span></div>
      <div class="field cr-only"><label>Start money ($k)</label>
        <input type="range" id="c-money" min="0" max="100" step="5" value="${cfg.startMoney / 1000}">
        <span class="val" id="c-money-v">${cfg.startMoney / 1000}</span></div>
      <div class="field dm-only"><label>Frag limit</label>
        <input type="range" id="c-frag" min="5" max="60" step="5" value="${cfg.fragLimit}">
        <span class="val" id="c-frag-v">${cfg.fragLimit}</span></div>
    `;
  }

  /** Wire the config-field inputs to mutate `cfg` in place. */
  private wireConfig(s: HTMLElement, cfg: LobbyConfig) {
    const range = (id: string, set: (v: number) => void) => {
      const el = s.querySelector('#' + id) as HTMLInputElement | null;
      const v = s.querySelector('#' + id + '-v');
      if (!el) return;
      el.oninput = () => { set(+el.value); if (v) v.textContent = el.value; };
    };
    range('c-max', (v) => { cfg.maxPlayers = v; });
    range('c-bots', (v) => { cfg.botCount = v; });
    range('c-dur', (v) => { cfg.durationSec = v * 60; });
    range('c-target', (v) => { cfg.winTarget = v * 1000; });
    range('c-money', (v) => { cfg.startMoney = v * 1000; });
    range('c-frag', (v) => { cfg.fragLimit = v; });
    const modeSeg = s.querySelector('#c-mode');
    const mapSel = s.querySelector('#c-map') as HTMLSelectElement | null;
    const mapField = s.querySelector('#c-map-field') as HTMLElement | null;
    const refreshMaps = () => {
      if (!mapSel) return;
      const maps = mapsForMode(cfg.mode);
      mapSel.innerHTML = maps
        .map((m) => `<option value="${m.id}" title="${m.description}">${m.name}</option>`)
        .join('');
      if (!maps.some((m) => m.id === cfg.mapId)) cfg.mapId = DEFAULT_MAP[cfg.mode];
      mapSel.value = cfg.mapId;
      if (mapField) mapField.style.display = maps.length > 1 ? '' : 'none';
    };
    if (mapSel) mapSel.onchange = () => { cfg.mapId = mapSel.value; };

    const paint = () => {
      modeSeg?.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('on', (b as HTMLElement).dataset.m === cfg.mode));
      s.querySelectorAll('.cr-only').forEach((e) =>
        ((e as HTMLElement).style.display = cfg.mode === 'cashraid' ? '' : 'none'));
      s.querySelectorAll('.dm-only').forEach((e) =>
        ((e as HTMLElement).style.display = cfg.mode === 'deathmatch' ? '' : 'none'));
      refreshMaps();
    };
    modeSeg?.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        cfg.mode = (b as HTMLElement).dataset.m as GameMode;
        paint();
      });
    });
    paint();
  }

  showCreateRoom(error?: string) {
    this.clear();
    const cfg = this.lobbyCfg;
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:42px;">CREATE <span class="x">ROOM</span></div>
      <div class="menu-card" style="min-width:470px;">
        <h3>Room Settings</h3>
        ${this.configFields(cfg)}
        <div class="field"><label>Lobby</label>
          <div class="seg" id="c-pub">
            <button data-p="1">Public</button><button data-p="0">Private</button>
          </div></div>
        ${error ? `<div class="form-error">⚠ ${error}</div>` : ''}
        <div class="btn-row">
          <button class="primary" id="c-go">Create Room</button>
          <button id="c-back">Back</button>
        </div>
      </div>
    `;
    this.container.appendChild(s);
    this.wireConfig(s, cfg);
    const pub = s.querySelector('#c-pub')!;
    const paintPub = () => pub.querySelectorAll('button').forEach((b) =>
      b.classList.toggle('on', ((b as HTMLElement).dataset.p === '1') === cfg.isPublic));
    pub.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      cfg.isPublic = (b as HTMLElement).dataset.p === '1';
      paintPub();
    }));
    paintPub();
    (s.querySelector('#c-go') as HTMLButtonElement).onclick = () =>
      this.h.onCreateRoom(this.serverUrl, this.playerName, { ...cfg });
    (s.querySelector('#c-back') as HTMLButtonElement).onclick = () => this.showOnlineHub();
  }

  showJoinRoom(prefillCode = '', error?: string) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:44px;">JOIN <span class="x">ROOM</span></div>
      <div class="menu-card" style="min-width:420px;">
        <h3>Enter an Invite Code</h3>
        <div class="field"><label>Callsign</label>
          <input type="text" id="j-name" maxlength="14" value="${this.playerName}" style="${this.inputCss}"></div>
        <div class="field"><label>Server</label>
          <input type="text" id="j-url" value="${this.serverUrl}" style="${this.inputCss}"></div>
        <div class="field"><label>Invite code</label>
          <input type="text" id="j-code" maxlength="6" value="${prefillCode}"
            style="${this.inputCss}text-transform:uppercase;letter-spacing:4px;"></div>
        ${error ? `<div class="form-error">⚠ ${error}</div>` : ''}
        <div class="btn-row">
          <button class="primary" id="j-go">Join</button>
          <button id="j-back">Back</button>
        </div>
      </div>
    `;
    this.container.appendChild(s);
    (s.querySelector('#j-go') as HTMLButtonElement).onclick = () => {
      this.playerName = ((s.querySelector('#j-name') as HTMLInputElement).value.trim() || 'PLAYER').slice(0, 14);
      this.serverUrl = (s.querySelector('#j-url') as HTMLInputElement).value.trim() || this.serverUrl;
      const code = (s.querySelector('#j-code') as HTMLInputElement).value.trim().toUpperCase();
      this.h.onJoinRoom(this.serverUrl, this.playerName, code);
    };
    (s.querySelector('#j-back') as HTMLButtonElement).onclick = () => this.showOnlineHub();
  }

  /** Pre-match lobby — re-rendered on every server lobbyState. */
  showLobby(lobby: LobbyState, localId: number) {
    this.clear();
    this.lobbyCfg = { ...lobby.config };
    const isHost = lobby.hostId === localId;
    const me = lobby.members.find((m) => m.id === localId);
    const cash = lobby.config.mode === 'cashraid';
    const link = `${location.origin}${location.pathname}?room=${lobby.code}`;

    const memberRow = (m: LobbyState['members'][number]) => {
      const tag = m.ready
        ? '<span class="lm-ready">✓ READY</span>'
        : '<span class="lm-wait">WAITING</span>';
      const host = m.isHost ? '<span class="lm-host">★</span>' : '';
      const kick = (isHost && m.id !== localId)
        ? `<button class="lm-kick" data-kick="${m.id}">✕</button>` : '';
      return `<div class="lm-row${m.id === localId ? ' me' : ''}">` +
        `<span class="lm-name">${host}${m.name}</span>${tag}${kick}</div>`;
    };

    let roster: string;
    if (cash) {
      const col = (team: Team) => {
        const rows = lobby.members.filter((m) => m.team === team).map(memberRow).join('');
        return `<div class="lobby-team t${team}"><h4>${teamName(team)}</h4>` +
          `${rows || '<div class="lm-empty">— empty —</div>'}</div>`;
      };
      roster = `<div class="lobby-teams">${col(1)}${col(2)}</div>`;
    } else {
      roster = `<div class="lobby-list">${lobby.members.map(memberRow).join('')}</div>`;
    }

    const c = lobby.config;
    const settings = cash
      ? `${c.botCount} bots · ${Math.round(c.durationSec / 60)} min · win $${c.winTarget / 1000}k`
      : `${c.botCount} bots · ${Math.round(c.durationSec / 60)} min · ${c.fragLimit} frags`;

    const s = document.createElement('div');
    s.className = 'screen';
    s.innerHTML = `
      <div class="logo" style="font-size:38px;">
        ${cash ? 'CASH RAID' : 'DEATHMATCH'} <span class="x">LOBBY</span></div>
      <div class="lobby-code">INVITE CODE <b>${lobby.code}</b>
        <button id="lb-copy" class="mini">copy link</button></div>
      <div class="menu-card" style="min-width:540px;">
        ${roster}
        <div class="lobby-settings">${settings}</div>
        <div class="btn-row">
          ${cash ? `<button id="lb-t1">Join ${teamName(1)}</button>
                    <button id="lb-t2">Join ${teamName(2)}</button>` : ''}
          <button id="lb-ready" class="${me?.ready ? 'primary' : ''}">
            ${me?.ready ? 'Ready ✓' : 'Ready Up'}</button>
          ${isHost ? '<button class="primary" id="lb-start">Start Match</button>' : ''}
          <button id="lb-leave">Leave</button>
        </div>
        ${isHost ? '' : '<div class="help" style="margin-top:6px;">waiting for the host…</div>'}
      </div>
    `;
    this.container.appendChild(s);
    const copyBtn = s.querySelector('#lb-copy') as HTMLButtonElement;
    copyBtn.onclick = () => {
      navigator.clipboard?.writeText(link).catch(() => {});
      copyBtn.textContent = 'link copied!';
    };
    (s.querySelector('#lb-ready') as HTMLButtonElement).onclick =
      () => this.h.onLobbyReady(!me?.ready);
    (s.querySelector('#lb-leave') as HTMLButtonElement).onclick = () => this.h.onLeaveRoom();
    s.querySelector('#lb-t1')?.addEventListener('click', () => this.h.onLobbySelectTeam(1));
    s.querySelector('#lb-t2')?.addEventListener('click', () => this.h.onLobbySelectTeam(2));
    s.querySelector('#lb-start')?.addEventListener('click', () => this.h.onLobbyStart());
    s.querySelectorAll('[data-kick]').forEach((b) => b.addEventListener('click',
      () => this.h.onLobbyKick(+(b as HTMLElement).dataset.kick!)));
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
    const q = this.h.settings.quality;
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
        <div class="field">
          <label>Graphics</label>
          <div class="seg" id="p-qual">
            <button data-q="fast" class="${q === 'fast' ? 'on' : ''}">Fast</button>
            <button data-q="high" class="${q === 'high' ? 'on' : ''}">High</button>
          </div>
        </div>
        <div class="help" id="p-qual-note" style="margin-top:0;font-size:11px;">
          Fast: no bloom, lower shadows, capped pixel ratio. <b>Reload to apply.</b>
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

    const qualSeg = s.querySelector('#p-qual')!;
    qualSeg.querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        const v = (b as HTMLElement).dataset.q as GameSettings['quality'];
        qualSeg.querySelectorAll('button').forEach((bb) =>
          bb.classList.toggle('on', (bb as HTMLElement).dataset.q === v));
        this.h.onQuality(v);
      }));
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

  /** Cash Raid results: winning team, banks, MVP and per-player stats. */
  showCashRaidEnd(rules: CashRaidRules, actors: Actor[], localPlayer: Actor) {
    this.clear();
    const s = document.createElement('div');
    s.className = 'screen';
    const winner = rules.winner;
    const won = winner !== 0 && winner === localPlayer.team;
    const title = winner === 0 ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
    const color = winner === 0 ? '#ffd23f' : won ? '#6dff8a' : '#ff7a18';
    const ranked = rules.ranking(actors);
    const mvp = ranked[0];

    const teamBlock = (team: Team) => {
      const rows = actors
        .filter((a) => a.team === team)
        .sort((a, b) => (b.moneyBanked + b.moneyStolen) - (a.moneyBanked + a.moneyStolen))
        .map((a) => {
          const cls = a === localPlayer ? 'sb-row me' : 'sb-row';
          return `<div class="${cls}"><div>${a.name}${a === mvp ? ' ★' : ''}</div>` +
            `<div class="c">${a.frags}</div>` +
            `<div class="c">$${Math.floor(a.moneyStolen).toLocaleString()}</div>` +
            `<div class="c">$${Math.floor(a.moneyBanked).toLocaleString()}</div></div>`;
        }).join('');
      return `<div class="sb-team t${team}">${teamName(team)} ` +
        `<span>BANK $${rules.bank[team].toLocaleString()}</span></div>` +
        `<div class="sb-row head"><div>PLAYER</div><div class="c">KILLS</div>` +
        `<div class="c">STOLEN</div><div class="c">BANKED</div></div>${rows}`;
    };

    s.innerHTML = `
      <div class="logo" style="font-size:52px;color:${color};">${title}</div>
      <div class="tag">${winner === 0 ? 'The vaults are even' : `${teamName(winner)} team wins the raid`}
        &nbsp;·&nbsp; MVP ${mvp ? mvp.name : '—'}</div>
      <div id="scoreboard" style="position:relative;transform:none;left:auto;top:auto;width:520px;">
        <h2>Cash Raid — Results</h2>
        ${teamBlock(1)}${teamBlock(2)}
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

/**
 * Mini Three.js scene for the character-select screen. Renders one cloned
 * character on a small turntable inside a dedicated canvas. `show(id)` swaps
 * the displayed character; `dispose()` tears everything down when the screen
 * is closed.
 */
class CharacterPreview {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private mount = new THREE.Group();
  private current: CharacterInstance | null = null;
  private last = performance.now();
  private alive = true;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0x8aa0ff, 0x1a1d26, 1.1));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x36e0ff, 30, 12);
    rim.position.set(-2.5, 2.4, -2);
    this.scene.add(rim);

    // Pedestal disc with a soft glow rim — UT-ish stage feel.
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.35, 0.1, 48),
      new THREE.MeshStandardMaterial({ color: 0x0d1623, metalness: 0.6, roughness: 0.4 }),
    );
    disc.position.y = -0.05;
    this.scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.25, 0.04, 12, 48),
      new THREE.MeshBasicMaterial({ color: 0x36e0ff }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.01;
    this.scene.add(ring);

    this.scene.add(this.mount);

    this.camera = new THREE.PerspectiveCamera(35, canvas.width / canvas.height, 0.1, 50);
    this.camera.position.set(0, 1.5, 3.6);
    this.camera.lookAt(0, 0.95, 0);

    this.loop();
  }

  async show(id: string) {
    await loadCharacter(id);
    if (!this.alive) return;
    if (this.current) {
      this.mount.remove(this.current.root);
      this.current = null;
    }
    const inst = createCharacter(id, 0x36e0ff);
    inst.setWeapon('pulse');
    inst.play('Idle', 0);
    this.mount.add(inst.root);
    this.current = inst;
  }

  private loop = () => {
    if (!this.alive) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.mount.rotation.y += dt * 0.7;
    if (this.current) this.current.update(dt);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.loop);
  };

  dispose() {
    this.alive = false;
    this.renderer.dispose();
  }
}
