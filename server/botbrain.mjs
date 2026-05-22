/**
 * Lightweight server-side bot AI for Cash Raid + deathmatch. No physics: bots
 * navigate the waypoint graph at a fixed speed and fire at nearby enemies
 * (the room applies the damage authoritatively).
 */
import { WAYPOINTS, LINKS } from './cashraid-map.mjs';

const BOT_SPEED = 8.5;
const SIGHT = 32;
const FIRE_CD = { rookie: 0.95, skilled: 0.6, deadly: 0.4 };
const FIRE_DMG = { rookie: 11, skilled: 17, deadly: 24 };

/** Index of the waypoint nearest (x,z). */
export function nearestWp(x, z) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const w = WAYPOINTS[i];
    const d = (w[0] - x) ** 2 + (w[2] - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** A* over the server waypoint graph; returns a list of waypoint indices. */
export function findPath(start, goal) {
  if (start < 0 || goal < 0) return [];
  if (start === goal) return [start];
  const dist = (a, b) => {
    const A = WAYPOINTS[a], B = WAYPOINTS[b];
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  };
  const open = new Set([start]);
  const came = new Map();
  const g = new Map([[start, 0]]);
  const f = new Map([[start, dist(start, goal)]]);
  while (open.size) {
    let cur = -1, bf = Infinity;
    for (const n of open) { const v = f.get(n) ?? Infinity; if (v < bf) { bf = v; cur = n; } }
    if (cur === goal) {
      const p = [cur]; let c = cur;
      while (came.has(c)) { c = came.get(c); p.push(c); }
      return p.reverse();
    }
    open.delete(cur);
    for (const nx of LINKS[cur]) {
      const t = (g.get(cur) ?? Infinity) + dist(cur, nx);
      if (t < (g.get(nx) ?? Infinity)) {
        came.set(nx, cur); g.set(nx, t); f.set(nx, t + dist(nx, goal)); open.add(nx);
      }
    }
  }
  return [];
}

/** Fresh per-bot AI state. */
export function makeBotState(role) {
  return { role, path: [], pi: 0, repathAt: 0, fireAt: 0 };
}

/** Advance one bot for `dt` seconds within `room`. */
export function tickBot(bot, room, dt) {
  if (!bot.alive) { bot.interact = false; bot.anim = 'Death'; return; }
  const ai = bot.ai;
  const now = room.clock;
  const cash = room.config.mode === 'cashraid';

  // nearest enemy
  let target = null, td = Infinity;
  for (const p of room.players.values()) {
    if (p === bot || !p.alive) continue;
    if (cash && p.team === bot.team) continue;
    const d = Math.hypot(p.x - bot.x, p.z - bot.z);
    if (d < td) { td = d; target = p; }
  }

  // objective
  let objX = bot.x, objZ = bot.z, objVault = null;
  if (cash) {
    if (bot.carried >= 1) { const v = room.ownVault(bot.team); objX = v.x; objZ = v.z; objVault = v; }
    else if (ai.role === 'defender') { const v = room.ownVault(bot.team); objX = v.x; objZ = v.z; }
    else { const v = room.enemyVault(bot.team); objX = v.x; objZ = v.z; objVault = v; }
  } else if (target) {
    objX = target.x; objZ = target.z;
  }

  // standing in the objective vault → channel + hold position
  if (objVault && Math.hypot(bot.x - objVault.x, bot.z - objVault.z) < objVault.hx) {
    bot.interact = true;
    bot.vx = bot.vz = 0;
    bot.anim = 'Idle';
    if (target) bot.yaw = Math.atan2(-(target.x - bot.x), -(target.z - bot.z));
    shoot(bot, target, td, room, now);
    return;
  }
  bot.interact = false;

  // navigate toward the objective along the waypoint graph
  if (ai.path.length === 0 || ai.pi >= ai.path.length || now >= ai.repathAt) {
    const idx = findPath(nearestWp(bot.x, bot.z), nearestWp(objX, objZ));
    ai.path = idx.map((i) => WAYPOINTS[i]);
    ai.path.push([objX, 0, objZ]);
    ai.pi = 0;
    ai.repathAt = now + 3.5;
  }
  let node = ai.path[ai.pi];
  while (node && Math.hypot(bot.x - node[0], bot.z - node[2]) < 2.2) {
    ai.pi++; node = ai.path[ai.pi];
  }
  if (!node) node = [objX, 0, objZ];
  const dx = node[0] - bot.x, dz = node[2] - bot.z;
  const len = Math.hypot(dx, dz) || 1;
  bot.x += (dx / len) * BOT_SPEED * dt;
  bot.z += (dz / len) * BOT_SPEED * dt;
  bot.yaw = Math.atan2(-dx / len, -dz / len);
  bot.anim = 'Running';

  // shoot while moving if an enemy is in sight
  if (target && td < SIGHT) {
    bot.yaw = Math.atan2(-(target.x - bot.x), -(target.z - bot.z));
    shoot(bot, target, td, room, now);
  }
}

function shoot(bot, target, td, room, now) {
  if (!target || td > SIGHT || now < bot.ai.fireAt) return;
  bot.ai.fireAt = now + (FIRE_CD[room.config.difficulty] ?? 0.6);
  const dx = target.x - bot.x;
  const dy = (target.y + 1.0) - (bot.y + 1.0);
  const dz = target.z - bot.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  room.broadcast({
    t: 'fire', id: bot.id, weapon: bot.weapon, alt: false,
    ox: bot.x, oy: bot.y + 1.0, oz: bot.z,
    dx: dx / len, dy: dy / len, dz: dz / len,
  });
  room.botDamage(bot, target, FIRE_DMG[room.config.difficulty] ?? 17);
}
