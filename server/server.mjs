/**
 * Frag Protocol — authoritative online server.
 *
 * Hosts many independent rooms keyed by a 6-character invite code. Each room
 * runs a pre-match lobby then an authoritative match (deathmatch or Cash
 * Raid). The server owns health, kills, the clock and all Cash Raid money;
 * clients report transforms and request actions. See src/net/protocol.ts.
 */
import { WebSocketServer } from 'ws';
import { Room, sanitiseCharacter } from './room.mjs';

const PORT = Number(process.env.PORT) || 2567;
const TICK_MS = 50; // 20 Hz

/** @type {Map<string, Room>} */
const rooms = new Map();
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode() {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < 6; i++) {
      c += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
    }
    if (!rooms.has(c)) return c;
  }
  return 'R' + Date.now().toString(36).slice(-5).toUpperCase();
}

/** Clamp + sanitise a client-supplied lobby config. */
function sanitiseConfig(raw) {
  const r = raw || {};
  const num = (v, lo, hi, d) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  const mode = r.mode === 'cashraid' ? 'cashraid' : 'deathmatch';
  const diff = ['rookie', 'skilled', 'deadly'].includes(r.difficulty) ? r.difficulty : 'skilled';
  return {
    mode,
    maxPlayers: num(r.maxPlayers, 2, 12, 8),
    durationSec: num(r.durationSec, 120, 1800, mode === 'cashraid' ? 900 : 600),
    botCount: num(r.botCount, 0, 10, mode === 'cashraid' ? 4 : 3),
    fragLimit: num(r.fragLimit, 5, 80, 25),
    difficulty: diff,
    startMoney: num(r.startMoney, 0, 100000, 20000),
    winTarget: num(r.winTarget, 10000, 1000000, 100000),
    isPublic: !!r.isPublic,
  };
}

const wss = new WebSocketServer({ port: PORT });
console.log(`Frag Protocol server listening on ws://localhost:${PORT}`);

const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

wss.on('connection', (ws) => {
  /** @type {Room|null} */ let room = null;
  /** @type {any} */ let player = null;

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }

    // --- not in a room yet ---
    if (!room) {
      if (msg.t === 'createRoom') {
        const code = genCode();
        room = new Room(code, sanitiseConfig(msg.config));
        rooms.set(code, room);
        player = room.addHuman(ws, msg.name, msg.character);
        send(ws, { t: 'roomJoined', code, youId: player.id, host: true });
        room.broadcastLobby();
        console.log(`+ room ${code} created (${room.config.mode})`);
      } else if (msg.t === 'joinRoom') {
        const code = String(msg.code || '').toUpperCase().trim();
        const target = rooms.get(code);
        if (!target) { send(ws, { t: 'roomError', message: 'room not found' }); return; }
        if (target.phase !== 'lobby') { send(ws, { t: 'roomError', message: 'match already in progress' }); return; }
        const humans = [...target.players.values()].filter((p) => !p.isBot).length;
        if (humans >= target.config.maxPlayers) {
          send(ws, { t: 'roomError', message: 'room is full' }); return;
        }
        room = target;
        player = room.addHuman(ws, msg.name, msg.character);
        send(ws, { t: 'roomJoined', code, youId: player.id, host: player.id === room.hostId });
        room.broadcastLobby();
      } else {
        send(ws, { t: 'roomError', message: 'create or join a room first' });
      }
      return;
    }

    const isHost = player && player.id === room.hostId;

    switch (msg.t) {
      case 'leaveRoom':
        ws.close();
        break;
      case 'lobbySetReady':
        if (room.phase === 'lobby') { player.ready = !!msg.ready; room.broadcastLobby(); }
        break;
      case 'lobbySetCharacter':
        if (room.phase === 'lobby' && typeof msg.character === 'string') {
          player.character = sanitiseCharacter(msg.character);
          room.broadcastLobby();
        }
        break;
      case 'lobbySelectTeam':
        if (room.phase === 'lobby' && (msg.team === 1 || msg.team === 2)) {
          player.team = msg.team; room.broadcastLobby();
        }
        break;
      case 'lobbyConfig':
        if (isHost && room.phase === 'lobby') {
          const cfg = sanitiseConfig(msg.config);
          const humans = [...room.players.values()].filter((p) => !p.isBot).length;
          cfg.maxPlayers = Math.max(cfg.maxPlayers, humans);
          room.config = cfg;
          room.match = room.freshMatch();
          room.broadcastLobby();
        }
        break;
      case 'lobbyKick':
        if (isHost && room.phase === 'lobby') {
          const victim = room.players.get(msg.id);
          if (victim && !victim.isBot && victim.id !== room.hostId) {
            send(victim.ws, { t: 'kicked' });
            room.removePlayer(victim.id);
            victim.ws.close();
          }
        }
        break;
      case 'lobbyStart':
        if (isHost && room.phase === 'lobby') {
          room.start();
          console.log(`> room ${room.code} match started`);
        }
        break;
      case 'input': room.onInput(player, msg); break;
      case 'fire':  room.onFire(player, msg); break;
      case 'hit':   room.onHit(player, msg); break;
      case 'buy':   room.onBuy(player, msg); break;
    }
  });

  ws.on('close', () => {
    if (!room || !player) return;
    const code = room.code;
    room.removePlayer(player.id);
    const humans = [...room.players.values()].filter((p) => !p.isBot).length;
    if (humans === 0) {
      rooms.delete(code);
      console.log(`- room ${code} closed`);
    }
    room = null;
    player = null;
  });
});

// fixed-rate tick: advance every room, prune empties
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = (now - last) / 1000;
  last = now;
  for (const [code, room] of rooms) {
    room.tick(dt);
    if (room.empty || room.players.size === 0) rooms.delete(code);
  }
}, TICK_MS);
