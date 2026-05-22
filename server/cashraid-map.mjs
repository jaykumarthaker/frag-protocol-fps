/**
 * Server-side Cash Raid map data — vault zones, buy stations, team spawns and
 * a waypoint graph for server bots. Coordinates mirror
 * `src/arena/CashRaidArena.ts`; keep the two in sync.
 */

const BASE_Z = 26;

/** Mirror a team-1 local (x,z) to a team's world coordinates. */
const mir = (team, x, z) => (team === 1 ? [x, z] : [-x, -z]);

export const VAULTS = [1, 2].map((team) => {
  const [x, z] = mir(team, -8, -BASE_Z);
  return { team, x, y: 0, z, hx: 3, hy: 2.6, hz: 3 };
});

export const BUY_STATIONS = [1, 2].map((team) => {
  const [x, z] = mir(team, 10, -BASE_Z);
  return { team, x, y: 0, z, radius: 4 };
});

export const TEAM_SPAWNS = { 1: [], 2: [] };
for (const team of [1, 2]) {
  for (const lx of [-12, -4, 4, 12]) {
    const [x, z] = mir(team, lx, -BASE_Z + 4);
    TEAM_SPAWNS[team].push([x, 0.05, z]);
  }
}

/** Waypoint positions [x,y,z] — mirrors CashRaidArena.buildCashRaidWaypoints. */
export const WAYPOINTS = [];
const wp = (team, x, z, y = 0) => {
  const [wx, wz] = mir(team, x, z);
  WAYPOINTS.push([wx, y, wz]);
};
for (const team of [1, 2]) {
  wp(team, -8, -BASE_Z);     // vault
  wp(team, -8, -21.5);       // vault mouth
  wp(team, 10, -BASE_Z);     // buy
  wp(team, 0, -22);          // base mouth
  wp(team, 22, -16);         // flank entry
}
for (const [x, z] of [
  [22, 0], [-22, 0], [13, 11], [-13, 11], [13, -11], [-13, -11], [0, 14], [0, -14],
]) WAYPOINTS.push([x, 0, z]);
WAYPOINTS.push([0, 3, 0], [4.5, 3, 4.5], [-4.5, 3, -4.5]);

/** Links by proximity (no line-of-sight test — nodes sit in open lanes). */
export const LINKS = WAYPOINTS.map(() => []);
const MAX_LINK = 20;
for (let i = 0; i < WAYPOINTS.length; i++) {
  for (let j = i + 1; j < WAYPOINTS.length; j++) {
    const a = WAYPOINTS[i], b = WAYPOINTS[j];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d <= MAX_LINK) { LINKS[i].push(j); LINKS[j].push(i); }
  }
}

/** Vault that contains the feet point (x, feetY, z), or null. */
export function vaultAt(x, feetY, z) {
  for (const v of VAULTS) {
    if (
      Math.abs(x - v.x) < v.hx && Math.abs(z - v.z) < v.hz &&
      feetY < v.y + v.hy && feetY > v.y - 1
    ) return v;
  }
  return null;
}

/** Buy station that contains (x, z), or null. */
export function buyStationAt(x, z) {
  for (const b of BUY_STATIONS) {
    const dx = x - b.x, dz = z - b.z;
    if (dx * dx + dz * dz < b.radius * b.radius) return b;
  }
  return null;
}
