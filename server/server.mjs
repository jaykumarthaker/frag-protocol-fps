/**
 * Frag Protocol — authoritative online deathmatch server.
 *
 * Model: clients simulate their own player locally and report transforms;
 * the server is authoritative for health, kills, scores and the match. Hits
 * are reported by the firing client and applied server-side, so every client
 * agrees on damage and standings. Players-only (no bots / pickups in v1).
 *
 * Protocol is line-delimited JSON over WebSocket. See src/net/protocol.ts on
 * the client for the message shapes.
 */
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT) || 2567;
const TICK_MS = 50;            // 20 Hz snapshots
const RESPAWN_SEC = 2.5;
const FRAG_LIMIT = 25;
const TIME_LIMIT = 600;
const MATCH_RESET_SEC = 9;

// Spawn points mirror src/arena/Arena.ts (feet positions).
const SPAWNS = [
  [22, 0.05, 22], [-22, 0.05, 22], [22, 0.05, -22], [-22, 0.05, -22],
  [26, 0.05, 0], [-26, 0.05, 0], [0, 0.05, 26], [0, 0.05, -26],
];
const COLORS = [0x36e0ff, 0xff7a18, 0xff3b3b, 0xb98bff, 0x6dff8a, 0xffd23f, 0xff5ec4, 0x5ec8ff];

let nextId = 1;
/** @type {Map<number, any>} */
const players = new Map();
let match = { timeLeft: TIME_LIMIT, over: false, fragLimit: FRAG_LIMIT, winnerId: 0 };

const wss = new WebSocketServer({ port: PORT });
console.log(`Frag Protocol server listening on ws://localhost:${PORT}`);

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
function broadcast(msg, exceptId = 0) {
  const s = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s);
  }
}

/** Spawn point furthest from currently-alive players. */
function pickSpawn() {
  let best = SPAWNS[0];
  let bestScore = -1;
  for (const sp of SPAWNS) {
    let minD = 1e9;
    for (const p of players.values()) {
      if (!p.alive) continue;
      minD = Math.min(minD, Math.hypot(p.x - sp[0], p.z - sp[2]));
    }
    const score = (minD === 1e9 ? 100 : minD) + Math.random() * 6;
    if (score > bestScore) { bestScore = score; best = sp; }
  }
  return best;
}

const publicPlayer = (p) => ({
  id: p.id, name: p.name, color: p.color,
  x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch,
  vx: p.vx, vy: p.vy, vz: p.vz, weapon: p.weapon, anim: p.anim,
  health: p.health, armor: p.armor, alive: p.alive, frags: p.frags, deaths: p.deaths,
});

function spawnPlayer(p) {
  const sp = pickSpawn();
  p.x = sp[0]; p.y = sp[1]; p.z = sp[2];
  p.vx = p.vy = p.vz = 0;
  p.health = 100; p.armor = 0; p.alive = true; p.respawnAt = 0;
  broadcast({ t: 'spawn', id: p.id, x: sp[0], y: sp[1], z: sp[2] });
}

function applyHit(attacker, msg) {
  if (match.over) return;
  const victim = players.get(msg.targetId);
  if (!victim || !victim.alive) return;
  if (!attacker.alive && attacker.id !== victim.id) return;

  let amount = Math.max(0, Math.min(500, Number(msg.amount) || 0));
  if (victim.armor > 0) {
    const absorbed = Math.min(victim.armor, amount * 0.66);
    victim.armor -= absorbed;
    amount -= absorbed;
  }
  victim.health -= amount;
  if (victim.health > 0) return;

  // death
  victim.health = 0;
  victim.alive = false;
  victim.deaths++;
  victim.respawnAt = Date.now() + RESPAWN_SEC * 1000;
  const suicide = attacker.id === victim.id;
  if (suicide) victim.frags = Math.max(0, victim.frags - 1);
  else attacker.frags++;
  broadcast({
    t: 'kill',
    killerId: suicide ? 0 : attacker.id,
    victimId: victim.id,
    weapon: msg.weapon || 'railgun',
    headshot: !!msg.headshot,
  });
  checkMatchEnd();
}

function checkMatchEnd() {
  let leader = null;
  for (const p of players.values()) if (!leader || p.frags > leader.frags) leader = p;
  if (leader && leader.frags >= match.fragLimit) endMatch(leader.id);
}

function endMatch(winnerId) {
  if (match.over) return;
  match.over = true;
  match.winnerId = winnerId || 0;
  broadcast({ t: 'matchOver', winnerId: match.winnerId });
  setTimeout(resetMatch, MATCH_RESET_SEC * 1000);
}

function resetMatch() {
  match = { timeLeft: TIME_LIMIT, over: false, fragLimit: FRAG_LIMIT, winnerId: 0 };
  for (const p of players.values()) {
    p.frags = 0; p.deaths = 0;
    spawnPlayer(p);
  }
  broadcast({ t: 'matchReset', match });
}

wss.on('connection', (ws) => {
  let player = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    if (msg.t === 'join') {
      if (player) return;
      const id = nextId++;
      const sp = pickSpawn();
      player = {
        id, ws,
        name: String(msg.name || 'PLAYER').slice(0, 14).toUpperCase() || 'PLAYER',
        color: COLORS[(id - 1) % COLORS.length],
        x: sp[0], y: sp[1], z: sp[2], yaw: 0, pitch: 0,
        vx: 0, vy: 0, vz: 0, weapon: 'shard', anim: 'Idle',
        health: 100, armor: 0, alive: true, frags: 0, deaths: 0, respawnAt: 0,
      };
      players.set(id, player);
      send(ws, {
        t: 'welcome', id,
        players: [...players.values()].map(publicPlayer),
        match,
      });
      broadcast({ t: 'playerJoined', player: publicPlayer(player) }, id);
      console.log(`+ ${player.name} (#${id}) — ${players.size} online`);
      return;
    }
    if (!player) return;

    switch (msg.t) {
      case 'input':
        player.x = msg.x; player.y = msg.y; player.z = msg.z;
        player.yaw = msg.yaw; player.pitch = msg.pitch;
        player.vx = msg.vx; player.vy = msg.vy; player.vz = msg.vz;
        player.weapon = msg.weapon; player.anim = msg.anim;
        break;
      case 'fire':
        broadcast({
          t: 'fire', id: player.id, weapon: msg.weapon, alt: !!msg.alt,
          ox: msg.ox, oy: msg.oy, oz: msg.oz, dx: msg.dx, dy: msg.dy, dz: msg.dz,
        }, player.id);
        break;
      case 'hit':
        applyHit(player, msg);
        break;
    }
  });

  ws.on('close', () => {
    if (!player) return;
    players.delete(player.id);
    broadcast({ t: 'playerLeft', id: player.id });
    console.log(`- ${player.name} — ${players.size} online`);
  });
});

// fixed-rate tick: clock, respawns, snapshot broadcast
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;

  if (!match.over) {
    match.timeLeft -= dt;
    if (match.timeLeft <= 0) { match.timeLeft = 0; endMatch(0); }
  }
  for (const p of players.values()) {
    if (!p.alive && p.respawnAt && now >= p.respawnAt) spawnPlayer(p);
  }
  if (players.size > 0) {
    broadcast({ t: 'state', players: [...players.values()].map(publicPlayer), match });
  }
}, TICK_MS);
