import type { Player } from '../entities/Player';
import type { Actor } from '../entities/Actor';
import type { MatchRules } from '../game/MatchRules';
import type { CashRaidRules } from '../game/CashRaidRules';
import type { Team } from '../core/types';
import { teamName } from '../game/teams';
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
  private banks: HTMLElement;
  private carried: HTMLElement;
  private prompt: HTMLElement;
  private cashfeed: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="crosshair"><span class="h left"></span><span class="h right"></span><span class="dot"></span></div>
      <div id="scope" class="hidden">
        <div class="lens"></div>
        <div class="bezel"></div>
        <div class="vline"></div>
        <div class="hline"></div>
        <div class="tick t1"></div><div class="tick t2"></div><div class="tick t3"></div>
        <div class="tick b1"></div><div class="tick b2"></div><div class="tick b3"></div>
        <div class="tick l1"></div><div class="tick l2"></div><div class="tick l3"></div>
        <div class="tick r1"></div><div class="tick r2"></div><div class="tick r3"></div>
        <div class="centerdot"></div>
      </div>
      <div id="hitmarker"><span class="a"></span><span class="b"></span><span class="c"></span><span class="d"></span></div>
      <div id="damage-flash"></div>
      <div id="matchstate">
        <div id="timer">0:00</div>
        <div id="scoreline"></div>
        <div id="banks" class="hidden"></div>
      </div>
      <div id="announce"></div>
      <div id="killfeed"></div>
      <div id="cashfeed"></div>
      <div id="carried" class="hidden"></div>
      <div id="prompt" class="hidden"></div>
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
    this.banks = this.q('#banks');
    this.carried = this.q('#carried');
    this.prompt = this.q('#prompt');
    this.cashfeed = this.q('#cashfeed');
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

  /** PUBG-style scope overlay — circular lens + crosshair mask. */
  setScoped(on: boolean) {
    this.root.classList.toggle('scoped', on);
    this.q('#scope').classList.toggle('hidden', !on);
  }

  /** Per-frame refresh of vitals, ammo, weapons, timer and score. */
  update(
    player: Player, match: MatchRules, actors: Actor[], time: number,
    cashRules?: CashRaidRules | null,
  ) {
    this.setScoped(player.ads);
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
      const owned = player.inventory.has(id);
      slot.textContent = `${def.slot}  ${def.name}  ${owned ? ammo : '—'}`;
      slot.classList.toggle('active', id === player.currentWeapon);
      slot.classList.toggle('empty', !owned || ammo <= 0);
    }

    this.timer.textContent = formatTime(match.timeLeft);

    if (cashRules) {
      this.scoreline.classList.add('hidden');
      this.banks.classList.remove('hidden');
      this.carried.classList.remove('hidden');
      const t = player.team;
      const mine = cashRules.bank[t] ?? 0;
      const theirs = cashRules.bank[t === 1 ? 2 : 1] ?? 0;
      this.banks.innerHTML =
        `<span class="bk t${t}">YOU $${mine.toLocaleString()}</span>` +
        `<span class="bk vs">vs</span>` +
        `<span class="bk t${t === 1 ? 2 : 1}">ENEMY $${theirs.toLocaleString()}</span>` +
        `<span class="bk tgt">TARGET $${cashRules.winTarget.toLocaleString()}</span>`;
      const carried = Math.floor(player.carried);
      this.carried.textContent = `▮ CARRYING  $${carried.toLocaleString()}`;
      this.carried.classList.toggle('heavy', carried >= 15000);
      this.carried.classList.toggle('empty', carried <= 0);
    } else {
      this.scoreline.classList.remove('hidden');
      this.banks.classList.add('hidden');
      this.carried.classList.add('hidden');
      this.prompt.classList.add('hidden');
      const ranked = match.ranking(actors);
      const rank = ranked.indexOf(player) + 1;
      this.scoreline.innerHTML =
        `FRAGS <b>${player.frags}</b> / ${match.config.fragLimit} ` +
        `&nbsp;•&nbsp; RANK <b>${rank}</b> / ${actors.length}`;
    }

    if (player.ampActive()) {
      this.powerup.textContent = `⚡ DAMAGE AMP  ${Math.ceil(player.ampUntil - time)}s`;
    } else {
      this.powerup.textContent = '';
    }
  }

  /** Contextual prompt ("HOLD E TO DEPOSIT", …); empty string hides it. */
  setPrompt(text: string) {
    this.prompt.textContent = text;
    this.prompt.classList.toggle('hidden', !text);
  }

  /** Cash transaction feed entry (deposits, steals, pickups, purchases). */
  addCashEvent(text: string) {
    const row = document.createElement('div');
    row.className = 'cf-row';
    row.textContent = text;
    this.cashfeed.appendChild(row);
    while (this.cashfeed.children.length > 5) this.cashfeed.removeChild(this.cashfeed.firstChild!);
    setTimeout(() => row.remove(), 4500);
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

  addKill(
    killer: string, victim: string, weaponLabel: string,
    killerIsPlayer: boolean, victimIsPlayer: boolean,
    killerTeam: Team = 0, victimTeam: Team = 0,
  ) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const tc = (t: Team) => (t === 1 ? ' team-1' : t === 2 ? ' team-2' : '');
    const k = `<span class="killer ${killerIsPlayer ? 'you' : ''}${tc(killerTeam)}">${killer}</span>`;
    const v = `<span class="victim ${victimIsPlayer ? 'you' : ''}${tc(victimTeam)}">${victim}</span>`;
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

  toggleScoreboard(
    show: boolean, match: MatchRules, actors: Actor[], player: Actor,
    cashRules?: CashRaidRules | null,
  ) {
    this.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    if (cashRules) { this.renderCashScoreboard(cashRules, actors, player); return; }
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

  private renderCashScoreboard(rules: CashRaidRules, actors: Actor[], player: Actor) {
    const teamBlock = (team: Team) => {
      const rows = actors
        .filter((a) => a.team === team)
        .sort((a, b) => (b.moneyBanked + b.moneyStolen) - (a.moneyBanked + a.moneyStolen))
        .map((a) => {
          const cls = a === player ? 'sb-row me' : 'sb-row';
          return `<div class="${cls}"><div>${a.name}</div>` +
            `<div class="c">${a.frags}</div>` +
            `<div class="c">$${Math.floor(a.moneyStolen).toLocaleString()}</div>` +
            `<div class="c">$${Math.floor(a.moneyBanked).toLocaleString()}</div></div>`;
        }).join('');
      return `<div class="sb-team t${team}">${teamName(team)} ` +
        `<span>BANK $${rules.bank[team].toLocaleString()}</span></div>` +
        `<div class="sb-row head"><div>PLAYER</div><div class="c">KILLS</div>` +
        `<div class="c">STOLEN</div><div class="c">BANKED</div></div>${rows}`;
    };
    this.scoreboard.innerHTML =
      `<h2>Cash Raid — Standings</h2>${teamBlock(1)}${teamBlock(2)}`;
  }
}

function formatTime(s: number): string {
  s = Math.max(0, s);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
