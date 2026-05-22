import type { Player } from '../entities/Player';
import type { Actor } from '../entities/Actor';
import type { Match } from '../game/Match';
import { WEAPONS, WEAPON_ORDER } from '../weapons/Weapons';

/** In-game heads-up display: an HTML/CSS overlay rendered above the canvas. */
export class HUD {
  root: HTMLDivElement;
  private healthNum: HTMLElement;
  private armorNum: HTMLElement;
  private ammoNum: HTMLElement;
  private weaponName: HTMLElement;
  private weaponBar: HTMLElement;
  private timer: HTMLElement;
  private scoreline: HTMLElement;
  private announceEl: HTMLElement;
  private killfeed: HTMLElement;
  private hitmarker: HTMLElement;
  private damageFlash: HTMLElement;
  private respawn: HTMLElement;
  private respawnText: HTMLElement;
  private scoreboard: HTMLElement;
  private powerup: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="crosshair"><span class="h left"></span><span class="h right"></span><span class="dot"></span></div>
      <div id="hitmarker"><span class="a"></span><span class="b"></span><span class="c"></span><span class="d"></span></div>
      <div id="damage-flash"></div>
      <div id="matchstate">
        <div id="timer">0:00</div>
        <div id="scoreline"></div>
      </div>
      <div id="announce"></div>
      <div id="killfeed"></div>
      <div id="vitals">
        <div class="vital"><div class="num" id="health-num">100</div><div class="lbl">HEALTH</div></div>
        <div class="vital"><div class="num" id="armor-num">0</div><div class="lbl">ARMOR</div></div>
      </div>
      <div id="ammo-box">
        <div id="ammo-num">0</div>
        <div id="weapon-name">—</div>
      </div>
      <div id="weapon-bar"></div>
      <div id="powerup"></div>
      <div id="respawn" class="hidden">
        <div class="big">FRAGGED</div>
        <div class="sub" id="respawn-text">RESPAWNING…</div>
      </div>
      <div id="scoreboard" class="hidden"></div>
    `;
    parent.appendChild(this.root);

    this.healthNum = this.q('#health-num');
    this.armorNum = this.q('#armor-num');
    this.ammoNum = this.q('#ammo-num');
    this.weaponName = this.q('#weapon-name');
    this.weaponBar = this.q('#weapon-bar');
    this.timer = this.q('#timer');
    this.scoreline = this.q('#scoreline');
    this.announceEl = this.q('#announce');
    this.killfeed = this.q('#killfeed');
    this.hitmarker = this.q('#hitmarker');
    this.damageFlash = this.q('#damage-flash');
    this.respawn = this.q('#respawn');
    this.respawnText = this.q('#respawn-text');
    this.scoreboard = this.q('#scoreboard');
    this.powerup = this.q('#powerup');
    this.powerup.style.cssText =
      'position:absolute;left:28px;bottom:120px;color:#b98bff;font-size:14px;' +
      'letter-spacing:2px;text-shadow:0 0 12px #b98bff;';

    for (const id of WEAPON_ORDER) {
      const slot = document.createElement('div');
      slot.className = 'wslot';
      slot.dataset.weapon = id;
      this.weaponBar.appendChild(slot);
    }
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.root.querySelector(sel) as T;
  }

  setVisible(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  /** Per-frame refresh of vitals, ammo, weapons, timer and score. */
  update(player: Player, match: Match, actors: Actor[], time: number) {
    this.healthNum.textContent = String(Math.ceil(player.health));
    this.healthNum.classList.toggle('low', player.health <= 30);
    this.armorNum.textContent = String(Math.ceil(player.armor));

    const w = WEAPONS[player.currentWeapon];
    this.ammoNum.textContent = String(player.ammo[player.currentWeapon] ?? 0);
    this.weaponName.textContent = w.name;

    for (const slot of Array.from(this.weaponBar.children) as HTMLElement[]) {
      const id = slot.dataset.weapon!;
      const def = WEAPONS[id];
      const ammo = player.ammo[id] ?? 0;
      slot.textContent = `${def.slot}  ${def.name}  ${ammo}`;
      slot.classList.toggle('active', id === player.currentWeapon);
      slot.classList.toggle('empty', ammo <= 0);
    }

    this.timer.textContent = formatTime(match.timeLeft);
    const ranked = match.ranking(actors);
    const rank = ranked.indexOf(player) + 1;
    this.scoreline.innerHTML =
      `FRAGS <b>${player.frags}</b> / ${match.config.fragLimit} ` +
      `&nbsp;•&nbsp; RANK <b>${rank}</b> / ${actors.length}`;

    if (player.ampActive()) {
      this.powerup.textContent = `⚡ DAMAGE AMP  ${Math.ceil(player.ampUntil - time)}s`;
    } else {
      this.powerup.textContent = '';
    }
  }

  showHitmarker(kill: boolean) {
    this.hitmarker.classList.toggle('kill', kill);
    this.hitmarker.classList.remove('hit-pop');
    void this.hitmarker.offsetWidth; // restart animation
    this.hitmarker.classList.add('hit-pop');
  }

  showDamageFlash() {
    this.damageFlash.classList.add('hit');
    requestAnimationFrame(() => this.damageFlash.classList.remove('hit'));
  }

  announce(text: string) {
    this.announceEl.textContent = text;
    this.announceEl.classList.remove('announce-pop');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('announce-pop');
  }

  addKill(killer: string, victim: string, weaponLabel: string, killerIsPlayer: boolean, victimIsPlayer: boolean) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const k = `<span class="killer ${killerIsPlayer ? 'you' : ''}">${killer}</span>`;
    const v = `<span class="victim ${victimIsPlayer ? 'you' : ''}">${victim}</span>`;
    row.innerHTML = `${k} <span class="wpn">» ${weaponLabel} »</span> ${v}`;
    this.killfeed.appendChild(row);
    while (this.killfeed.children.length > 5) this.killfeed.removeChild(this.killfeed.firstChild!);
    setTimeout(() => row.remove(), 5500);
  }

  notifyPickup(label: string) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    row.innerHTML = `<span class="wpn">PICKED UP</span> <span class="killer">${label}</span>`;
    this.killfeed.appendChild(row);
    while (this.killfeed.children.length > 5) this.killfeed.removeChild(this.killfeed.firstChild!);
    setTimeout(() => row.remove(), 2800);
  }

  showRespawn(text: string) {
    this.respawn.classList.remove('hidden');
    this.respawnText.textContent = text;
  }
  hideRespawn() {
    this.respawn.classList.add('hidden');
  }

  toggleScoreboard(show: boolean, match: Match, actors: Actor[], player: Actor) {
    this.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    const rows = match.ranking(actors).map((a) => {
      const cls = a === player ? 'sb-row me' : 'sb-row';
      return `<div class="${cls}"><div>${a.name}</div>` +
        `<div class="c">${a.frags}</div><div class="c">${a.deaths}</div>` +
        `<div class="c">${a.frags - a.deaths}</div></div>`;
    }).join('');
    this.scoreboard.innerHTML =
      `<h2>Deathmatch — Standings</h2>` +
      `<div class="sb-row head"><div>PLAYER</div><div class="c">FRAGS</div>` +
      `<div class="c">DEATHS</div><div class="c">SCORE</div></div>${rows}`;
  }
}

function formatTime(s: number): string {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
