/**
 * A single game room: pre-match lobby, then an authoritative match. One server
 * process hosts many rooms keyed by invite code. Health, kills, the clock and
 * all Cash Raid money (carried, banks, drops, deposits, purchases) are owned
 * here; clients only report transforms and request actions.
 */
import { VAULTS, BUY_STATIONS, TEAM_SPAWNS, vaultAt, buyStationAt } from './cashraid-map.mjs';
import { tickBot, makeBotState } from './botbrain.mjs';

const RESPAWN_SEC = 2.5;
const MATCH_RESET_SEC = 9;
const DEPOSIT_TIME = 2;
const STEAL_AMOUNT = 2500;
const CASH_LIFETIME = 30;
const DEATH_DROP = 0.70;

const DM_SPAWNS = [
  [22, 0.05, 22], [-22, 0.05, 22], [22, 0.05, -22], [-22, 0.05, -22],
  [26, 0.05, 0], [-26, 0.05, 0], [0, 0.05, 26], [0, 0.05, -26],
];
const COLORS = [0x36e0ff, 0xff7a18, 0xff3b3b, 0xb98bff, 0x6dff8a, 0xffd23f, 0xff5ec4, 0x5ec8ff];
const TEAM_COLOR = { 1: 0x36e0ff, 2: 0xff9a3c };
const BOT_NAMES = ['VEX', 'RAZE', 'NOVA', 'KILO', 'ZERO', 'ORYX', 'BANE', 'ECHO'];
/** Character ids the server is willing to accept / pick. Must stay in sync
 *  with the CHARACTERS registry in src/core/Models.ts. */
export const CHARACTER_IDS = [
  'robot',
  'soldier_m', 'soldier_f', 'bluesoldier_m', 'bluesoldier_f',
  'knight_m', 'knight_gold_m', 'knight_gold_f',
  'ninja_m', 'ninja_f', 'ninja_sand',
  'pirate_m', 'pirate_f',
  'viking_m', 'viking_f',
  'goblin_m', 'goblin_f',
  'cowboy_m', 'cowboy_f',
  'wizard', 'witch', 'elf',
  'zombie_m', 'zombie_f',
  'kimono_m', 'kimono_f',
  'suit_m', 'suit_f',
];
export function sanitiseCharacter(id) {
  return CHARACTER_IDS.includes(id) ? id : 'robot';
}

/** Buy catalogue — mirrors src/game/shop.ts. */
const SHOP = {
  shard: { kind: 'weapon', weaponId: 'shard', cost: 2000 },
  pulse_x: { kind: 'ammo', cost: 800 },
  railgun: { kind: 'weapon', weaponId: 'railgun', cost: 4000 },
  rocket: { kind: 'weapon', weaponId: 'rocket', cost: 6000 },
  armor: { kind: 'armor', cost: 1500, amount: 75 },
};

let nextPlayerId = 1;

export class Room {
  constructor(code, config) {
    this.code = code;
    this.config = config;
    this.phase = 'lobby';
    this.hostId = 0;
    this.players = new Map();
    this.clock = 0;
    this.match = this.freshMatch();
    this.cashDrops = [];
    this.nextDropId = 1;
    this.resetAt = 0;
    this.empty = false;
  }

  get cash() { return this.config.mode === 'cashraid'; }

  freshMatch() {
    const c = this.config;
    return {
      mode: c.mode, timeLeft: c.durationSec, over: false,
      fragLimit: c.fragLimit, winnerId: 0,
      bank1: c.startMoney, bank2: c.startMoney,
      winTarget: c.winTarget, winnerTeam: 0,
    };
  }

  // ---- networking helpers --------------------------------------------

  send(p, msg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
  broadcast(msg, exceptId = 0) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.ws && p.ws.readyState === 1) p.ws.send(s);
    }
  }

  // ---- lobby ----------------------------------------------------------

  /** Add a human player to the lobby. Returns the player record. */
  addHuman(ws, name, character) {
    const id = nextPlayerId++;
    const p = {
      id, ws, isBot: false,
      name: String(name || 'PLAYER').slice(0, 14).toUpperCase() || 'PLAYER',
      color: COLORS[(id - 1) % COLORS.length],
      character: sanitiseCharacter(character),
      team: 0, ready: false,
      x: 0, y: 0.05, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
      weapon: 'pulse', anim: 'Idle',
      health: 100, armor: 0, alive: true, frags: 0, deaths: 0, respawnAt: 0,
      carried: 0, moneyBanked: 0, moneyStolen: 0,
      loadout: new Set(), depositChannel: 0, interact: false, ai: null,
    };
    if (this.cash) p.team = this.smallerTeam();
    this.players.set(id, p);
    if (this.hostId === 0) this.hostId = id;
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.broadcast({ t: 'playerLeft', id });
    if (id === this.hostId) {
      // promote the next human, or close the room
      const next = [...this.players.values()].find((q) => !q.isBot);
      this.hostId = next ? next.id : 0;
    }
    if ([...this.players.values()].every((q) => q.isBot)) this.empty = true;
    if (this.phase === 'lobby') this.broadcastLobby();
  }

  /** Team with fewer members (Cash Raid balance). */
  smallerTeam() {
    let t1 = 0, t2 = 0;
    for (const p of this.players.values()) {
      if (p.team === 1) t1++; else if (p.team === 2) t2++;
    }
    return t1 <= t2 ? 1 : 2;
  }

  lobbyState() {
    return {
      code: this.code, hostId: this.hostId, phase: this.phase,
      config: this.config,
      members: [...this.players.values()]
        .filter((p) => !p.isBot)
        .map((p) => ({
          id: p.id, name: p.name, team: p.team,
          ready: p.ready, isHost: p.id === this.hostId, isBot: false,
          character: p.character || 'robot',
        })),
    };
  }
  broadcastLobby() { this.broadcast({ t: 'lobbyState', lobby: this.lobbyState() }); }

  // ---- match start ----------------------------------------------------

  /** Host starts the match: spawn humans + bots, broadcast matchStart. */
  start() {
    this.phase = 'playing';
    this.clock = 0;
    this.match = this.freshMatch();
    this.cashDrops = [];

    // fill with bots
    for (let i = 0; i < this.config.botCount; i++) {
      const id = nextPlayerId++;
      const bot = {
        id, ws: null, isBot: true,
        name: BOT_NAMES[i % BOT_NAMES.length],
        color: 0xff7a18, team: 0, ready: true,
        character: CHARACTER_IDS[1 + ((Math.random() * (CHARACTER_IDS.length - 1)) | 0)],
        x: 0, y: 0.05, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
        weapon: 'pulse', anim: 'Idle',
        health: 100, armor: 0, alive: true, frags: 0, deaths: 0, respawnAt: 0,
        carried: 0, moneyBanked: 0, moneyStolen: 0,
        loadout: new Set(), depositChannel: 0, interact: false,
        ai: makeBotState(Math.random() < 0.34 ? 'defender' : 'attacker'),
      };
      this.players.set(id, bot);
    }

    // balance teams across everyone (humans keep their pick where possible)
    if (this.cash) {
      const all = [...this.players.values()];
      let t1 = all.filter((p) => p.team === 1).length;
      let t2 = all.filter((p) => p.team === 2).length;
      for (const p of all) {
        if (p.team === 0) {
          if (t1 <= t2) { p.team = 1; t1++; } else { p.team = 2; t2++; }
        }
      }
      for (const p of all) p.color = TEAM_COLOR[p.team];
    }

    for (const p of this.players.values()) this.spawn(p, true);
    if (this.cash) for (const p of this.players.values()) this.botAutoBuy(p);

    for (const p of this.players.values()) {
      if (!p.isBot) {
        this.send(p, {
          t: 'matchStart', youId: p.id,
          players: [...this.players.values()].map(pub),
          match: this.match,
        });
      }
    }
  }

  /** Pick a spawn for a player and reset their vitals. */
  spawn(p, atStart = false) {
    let pts = DM_SPAWNS;
    if (this.cash && p.team !== 0) pts = TEAM_SPAWNS[p.team];
    // furthest from live enemies
    let best = pts[0], bestScore = -1;
    for (const sp of pts) {
      let minD = 1e9;
      for (const q of this.players.values()) {
        if (!q.alive || q === p) continue;
        minD = Math.min(minD, Math.hypot(q.x - sp[0], q.z - sp[2]));
      }
      const score = (minD === 1e9 ? 100 : minD) + Math.random() * 6;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    p.x = best[0]; p.y = best[1]; p.z = best[2];
    p.vx = p.vy = p.vz = 0;
    p.health = 100; p.armor = 0; p.alive = true; p.respawnAt = 0;
    p.depositChannel = 0; p.interact = false;
    if (this.cash) {
      p.carried = 0;
      if (p.loadout.size === 0) p.loadout = new Set(['pulse']);
      p.weapon = 'pulse';
    }
    if (!atStart) this.broadcast({ t: 'spawn', id: p.id, x: p.x, y: p.y, z: p.z });
  }

  /** A bot equips one weapon from the team bank shortly after spawning. */
  botAutoBuy(bot) {
    if (!bot.isBot || !this.cash || bot.loadout.size > 1) return;
    for (const id of ['shard', 'railgun', 'rocket']) {
      const item = SHOP[id];
      const bankKey = bot.team === 1 ? 'bank1' : 'bank2';
      if (this.match[bankKey] >= item.cost + 4000) {
        this.match[bankKey] -= item.cost;
        bot.loadout.add(id);
        return;
      }
    }
  }

  ownVault(team) { return VAULTS.find((v) => v.team === team); }
  enemyVault(team) { return VAULTS.find((v) => v.team !== team); }

  // ---- per-message handlers ------------------------------------------

  onInput(p, msg) {
    if (this.phase !== 'playing' || p.isBot) return;
    p.x = msg.x; p.y = msg.y; p.z = msg.z;
    p.yaw = msg.yaw; p.pitch = msg.pitch;
    p.vx = msg.vx; p.vy = msg.vy; p.vz = msg.vz;
    p.weapon = msg.weapon; p.anim = msg.anim;
    p.interact = !!msg.interact;
  }

  onFire(p, msg) {
    if (this.phase !== 'playing') return;
    this.broadcast({
      t: 'fire', id: p.id, weapon: msg.weapon, alt: !!msg.alt,
      ox: msg.ox, oy: msg.oy, oz: msg.oz, dx: msg.dx, dy: msg.dy, dz: msg.dz,
    }, p.id);
  }

  onHit(attacker, msg) {
    if (this.phase !== 'playing' || this.match.over) return;
    const victim = this.players.get(msg.targetId);
    if (!victim || !victim.alive) return;
    if (!attacker.alive && attacker.id !== victim.id) return;
    if (this.cash && attacker.id !== victim.id && attacker.team === victim.team) return;
    this.damage(attacker, victim, Math.max(0, Math.min(500, Number(msg.amount) || 0)),
      msg.weapon || 'railgun', !!msg.headshot);
  }

  /** Server bot deals damage to a victim. */
  botDamage(bot, victim, amount) {
    if (this.match.over || !victim.alive) return;
    if (this.cash && bot.team === victim.team) return;
    this.damage(bot, victim, amount, bot.weapon || 'pulse', false);
  }

  /** Apply authoritative damage; resolves death, drops and scoring. */
  damage(attacker, victim, amount, weapon, headshot) {
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, amount * 0.66);
      victim.armor -= absorbed; amount -= absorbed;
    }
    victim.health -= amount;
    if (victim.health > 0) return;

    victim.health = 0;
    victim.alive = false;
    victim.deaths++;
    victim.respawnAt = Date.now() + RESPAWN_SEC * 1000;
    const suicide = attacker.id === victim.id;
    if (suicide) victim.frags = Math.max(0, victim.frags - 1);
    else attacker.frags++;

    // Cash Raid: a dead carrier drops most of their money
    if (this.cash && victim.carried > 0) {
      const dropped = Math.floor(victim.carried * DEATH_DROP);
      victim.carried = 0;
      if (dropped > 0) {
        const id = this.nextDropId++;
        this.cashDrops.push({
          id, x: victim.x, y: victim.y, z: victim.z,
          amount: dropped, expireAt: this.clock + CASH_LIFETIME,
        });
        this.broadcast({ t: 'cashSpawned', dropId: id, x: victim.x, y: victim.y, z: victim.z, amount: dropped });
        this.broadcast({ t: 'cashEvent', text: `${victim.name} dropped  $${dropped.toLocaleString()}` });
      }
    }

    this.broadcast({
      t: 'kill', killerId: suicide ? 0 : attacker.id,
      victimId: victim.id, weapon, headshot,
    });
    this.checkWin();
  }

  onBuy(p, msg) {
    if (this.phase !== 'playing' || !this.cash || p.team === 0 || !p.alive) return;
    const item = SHOP[msg.itemId];
    if (!item) return;
    const bs = buyStationAt(p.x, p.z);
    if (!bs || bs.team !== p.team) return;
    if (item.kind === 'weapon' && item.weaponId && p.loadout.has(item.weaponId)) return;
    const bankKey = p.team === 1 ? 'bank1' : 'bank2';
    if (this.match[bankKey] < item.cost) return;
    this.match[bankKey] -= item.cost;
    if (item.kind === 'weapon') p.loadout.add(item.weaponId);
    else if (item.kind === 'armor') p.armor = Math.min(150, p.armor + (item.amount || 75));
    this.broadcast({ t: 'bankUpdate', bank1: this.match.bank1, bank2: this.match.bank2 });
    this.send(p, { t: 'loadoutUpdate', weapons: [...p.loadout], armor: p.armor });
    this.broadcast({ t: 'cashEvent', text: `${p.name} bought a ${item.kind} −$${item.cost.toLocaleString()}` });
  }

  // ---- tick -----------------------------------------------------------

  tick(dt) {
    if (this.phase !== 'playing') return;

    if (this.match.over) {
      if (this.resetAt && Date.now() >= this.resetAt) this.resetMatch();
    } else {
      this.clock += dt;
      this.match.timeLeft -= dt;

      for (const p of this.players.values()) {
        if (p.isBot) tickBot(p, this, dt);
      }
      if (this.cash) {
        this.updateChannels();
        this.updateCashDrops();
      }
      // respawns
      const now = Date.now();
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) {
          this.spawn(p);
          if (this.cash) this.botAutoBuy(p);
        }
      }
      this.checkWin();
      if (this.match.timeLeft <= 0 && !this.match.over) {
        this.match.timeLeft = 0;
        this.endMatch();
      }
    }

    if (this.players.size > 0) {
      this.broadcast({
        t: 'state',
        players: [...this.players.values()].map(pub),
        match: this.match,
      });
    }
  }

  updateChannels() {
    for (const p of this.players.values()) {
      if (!p.alive) { p.depositChannel = 0; continue; }
      const v = vaultAt(p.x, p.y, p.z);
      const mine = v && v.team === p.team;
      const valid = v && ((mine && p.carried > 0) || (!mine && v));
      if (p.interact && valid) {
        if (p.depositChannel === 0) p.depositChannel = this.clock;
        if (this.clock - p.depositChannel >= DEPOSIT_TIME) {
          p.depositChannel = 0;
          if (mine) this.deposit(p); else this.steal(p);
        }
      } else {
        p.depositChannel = 0;
      }
    }
  }

  deposit(p) {
    const amt = Math.floor(p.carried);
    if (amt <= 0) return;
    const bankKey = p.team === 1 ? 'bank1' : 'bank2';
    this.match[bankKey] += amt;
    p.moneyBanked += amt;
    p.carried = 0;
    this.broadcast({ t: 'bankUpdate', bank1: this.match.bank1, bank2: this.match.bank2 });
    this.broadcast({ t: 'cashEvent', text: `${p.name} banked  $${amt.toLocaleString()}` });
    this.checkWin();
  }

  steal(p) {
    p.carried += STEAL_AMOUNT;
    p.moneyStolen += STEAL_AMOUNT;
    this.broadcast({ t: 'cashEvent', text: `${p.name} raided  $${STEAL_AMOUNT.toLocaleString()}` });
  }

  updateCashDrops() {
    for (let i = this.cashDrops.length - 1; i >= 0; i--) {
      const d = this.cashDrops[i];
      if (this.clock >= d.expireAt) {
        this.cashDrops.splice(i, 1);
        this.broadcast({ t: 'cashExpired', dropId: d.id });
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const dx = p.x - d.x, dz = p.z - d.z, dy = p.y - d.y;
        if (dx * dx + dz * dz + dy * dy < 3.6) {
          p.carried += d.amount;
          p.moneyStolen += d.amount;
          this.cashDrops.splice(i, 1);
          this.broadcast({ t: 'cashCollected', dropId: d.id, byId: p.id, amount: d.amount });
          break;
        }
      }
    }
  }

  checkWin() {
    if (this.match.over) return;
    if (this.cash) {
      if (this.match.bank1 >= this.match.winTarget || this.match.bank2 >= this.match.winTarget) {
        this.endMatch();
      }
    } else {
      let leader = null;
      for (const p of this.players.values()) {
        if (!leader || p.frags > leader.frags) leader = p;
      }
      if (leader && leader.frags >= this.match.fragLimit) this.endMatch();
    }
  }

  endMatch() {
    if (this.match.over) return;
    this.match.over = true;
    if (this.cash) {
      this.match.winnerTeam = this.match.bank1 === this.match.bank2 ? 0
        : this.match.bank1 > this.match.bank2 ? 1 : 2;
    } else {
      let leader = null;
      for (const p of this.players.values()) {
        if (!leader || p.frags > leader.frags) leader = p;
      }
      this.match.winnerId = leader ? leader.id : 0;
    }
    this.broadcast({
      t: 'matchOver', winnerId: this.match.winnerId, winnerTeam: this.match.winnerTeam,
    });
    this.resetAt = Date.now() + MATCH_RESET_SEC * 1000;
  }

  resetMatch() {
    this.match = this.freshMatch();
    this.cashDrops = [];
    this.resetAt = 0;
    this.clock = 0;
    for (const p of this.players.values()) {
      p.frags = 0; p.deaths = 0;
      p.carried = 0; p.moneyBanked = 0; p.moneyStolen = 0;
      p.loadout = new Set();
      this.spawn(p); // broadcasts `spawn` so clients reposition
      if (this.cash) this.botAutoBuy(p);
    }
    this.broadcast({ t: 'matchReset', match: this.match });
  }
}

/** Public projection of a player for the wire. */
function pub(p) {
  return {
    id: p.id, name: p.name, color: p.color, team: p.team, isBot: p.isBot,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
    vx: p.vx, vy: p.vy, vz: p.vz, weapon: p.weapon, anim: p.anim,
    health: p.health, armor: p.armor, alive: p.alive,
    frags: p.frags, deaths: p.deaths, carried: Math.floor(p.carried),
    moneyBanked: Math.floor(p.moneyBanked), moneyStolen: Math.floor(p.moneyStolen),
    character: p.character || 'robot',
  };
}
