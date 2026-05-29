/**
 * Server-side Cash Raid map registry. Each entry packs everything the room
 * and the bot brain need to know about the layout (vault zones, buy stations,
 * team spawns and a waypoint graph). Coordinates here mirror the matching
 * client arena under src/arena/; keep them in sync by hand.
 *
 * There are two maps (atrium, duel) and both play in either mode. The room
 * receives a `mapId` and looks up the matching entry via `getMap(mapId)`. Bot
 * helpers (`nearestWp`, `findPath`) take the map as a parameter so different
 * rooms can run different geometries simultaneously.
 */

/** Mirror a team-1 local (x,z) to a team's world coordinates. */
const mir = (team, x, z) => (team === 1 ? [x, z] : [-x, -z]);

/** Auto-link waypoints by proximity (no LOS test — open-lane maps). */
function autoLink(waypoints, maxLink) {
  const links = waypoints.map(() => []);
  for (let i = 0; i < waypoints.length; i++) {
    for (let j = i + 1; j < waypoints.length; j++) {
      const a = waypoints[i], b = waypoints[j];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d <= maxLink) { links[i].push(j); links[j].push(i); }
    }
  }
  return links;
}

function vaultAtFactory(VAULTS) {
  return (x, feetY, z) => {
    for (const v of VAULTS) {
      if (
        Math.abs(x - v.x) < v.hx && Math.abs(z - v.z) < v.hz &&
        feetY < v.y + v.hy && feetY > v.y - 1
      ) return v;
    }
    return null;
  };
}

function buyStationAtFactory(BUY_STATIONS) {
  return (x, z) => {
    for (const b of BUY_STATIONS) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz < b.radius * b.radius) return b;
    }
    return null;
  };
}

// =====================================================================
//  Map: 'atrium' — The Atrium (vertical; mountain bases double as team
//  bases). Mirrors src/arena/AtriumArena.ts addCashRaidStructures().
//  Server bots have no physics/gravity, so they glide at base height across
//  the void — best-effort nav on this vertical map.
// =====================================================================
function buildAtrium() {
  const BASE_Z = 78, BASE_Y = 9, BASE_HX = 26, BASE_HZ = 16;
  // sign: team 1 = south (-z), team 2 = north (+z).
  const sgn = (team) => (team === 1 ? -1 : 1);

  const VAULTS = [1, 2].map((team) => {
    const s = sgn(team);
    // vault centre = (0, BASE_Y, cz + s*7); W=14, D=7 → hx 6.4, hz 2.9.
    return { team, x: 0, y: BASE_Y, z: s * BASE_Z + s * 7, hx: 6.4, hy: 3.0, hz: 2.9 };
  });
  const BUY_STATIONS = [1, 2].map((team) => {
    const s = sgn(team);
    return { team, x: s * 16, y: BASE_Y, z: s * BASE_Z, radius: 5.5 };
  });
  const TEAM_SPAWNS = { 1: [], 2: [] };
  for (const team of [1, 2]) {
    const s = sgn(team);
    const spawnZ = s * BASE_Z + s * 12;
    for (const sx of [-16, -6, 6, 16]) TEAM_SPAWNS[team].push([sx, BASE_Y + 0.05, spawnZ]);
  }
  // Deathmatch spawns: base fronts (BASE_HZ-8) + two sky decks.
  const SPAWNS = [];
  for (const team of [1, 2]) {
    const s = sgn(team);
    for (const sx of [-16, -6, 6, 16]) SPAWNS.push([sx, BASE_Y + 0.05, s * BASE_Z + s * (BASE_HZ - 8)]);
  }
  SPAWNS.push([26, 22.6, 0], [-26, 22.6, 0]);

  // Waypoints: base back/front + causeway chain + island ring. autoLink(24)
  // connects base→causeway→island→causeway→base without crossing the void.
  const WAYPOINTS = [];
  for (const team of [1, 2]) {
    const s = sgn(team);
    WAYPOINTS.push([0, BASE_Y, s * BASE_Z + s * 12]);          // spawn line
    WAYPOINTS.push([-16, BASE_Y, s * BASE_Z + s * 12]);
    WAYPOINTS.push([16, BASE_Y, s * BASE_Z + s * 12]);
    WAYPOINTS.push([0, BASE_Y, s * (BASE_Z - BASE_HZ)]);       // base front
    WAYPOINTS.push([0, 6.75, s * 54]);                         // causeway chain
    WAYPOINTS.push([0, 4.5, s * 46]);
    WAYPOINTS.push([0, 2.25, s * 38]);
  }
  for (const [x, z] of [
    [0, -25], [0, 25], [25, 0], [-25, 0],
    [22, 22], [-22, 22], [22, -22], [-22, -22],
  ]) WAYPOINTS.push([x, 0, z]);
  const LINKS = autoLink(WAYPOINTS, 24);

  // LOS blockers: the central spire (14×14 at y≈9) + the two vault bunkers.
  const WALLS = [];
  const wall = (x, z, hx, hz) => WALLS.push({ x, z, hx, hz });
  wall(0, 0, 7, 7); // spire trunk
  for (const team of [1, 2]) {
    const s = sgn(team);
    const vz = s * BASE_Z + s * 7;          // vault centre z
    const frontZ = vz + s * 3.5, backZ = vz - s * 3.5;
    wall(0, backZ, 7, 0.6);                 // back wall
    wall(-7, vz, 0.6, 3.5); wall(7, vz, 0.6, 3.5); // side walls
    wall(-5, frontZ, 2, 0.6); wall(5, frontZ, 2, 0.6); // front wings
  }

  return {
    id: 'atrium', VAULTS, BUY_STATIONS, TEAM_SPAWNS, SPAWNS, WAYPOINTS, LINKS, WALLS,
    vaultAt: vaultAtFactory(VAULTS),
    buyStationAt: buyStationAtFactory(BUY_STATIONS),
  };
}

// =====================================================================
//  Map: 'duel' — Foundry Duel (the generic blockout). Mirrors the base
//  Arena.addCashRaidStructures() default overlay + base build() cover.
// =====================================================================
function buildDuel() {
  const VAULTS = [
    { team: 1, x: 0, y: 0, z: -24, hx: 5.4, hy: 3.0, hz: 3.4 }, // W=12,D=8
    { team: 2, x: 0, y: 0, z: 24, hx: 5.4, hy: 3.0, hz: 3.4 },
  ];
  const BUY_STATIONS = [
    { team: 1, x: 16, y: 0, z: -24, radius: 5 },
    { team: 2, x: -16, y: 0, z: 24, radius: 5 },
  ];
  const TEAM_SPAWNS = {
    1: [[22, 0.05, -22], [-22, 0.05, -22], [0, 0.05, -26], [26, 0.05, 0]],
    2: [[22, 0.05, 22], [-22, 0.05, 22], [0, 0.05, 26], [-26, 0.05, 0]],
  };
  const SPAWNS = [...TEAM_SPAWNS[1], ...TEAM_SPAWNS[2]];

  const WAYPOINTS = [];
  const R = 23;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    WAYPOINTS.push([Math.cos(a) * R, 0, Math.sin(a) * R]);
  }
  WAYPOINTS.push([0, 0, 17], [0, 0, -17], [17, 0, 0], [-17, 0, 0], [0, 4.5, 0]);
  const LINKS = autoLink(WAYPOINTS, 18);

  const WALLS = [];
  const wall = (x, z, hx, hz) => WALLS.push({ x, z, hx, hz });
  wall(0, 0, 7, 7); // central platform (14×14)
  for (const [x, z] of [[14, 14], [-14, 14], [14, -14], [-14, -14]]) wall(x, z, 1, 1);
  for (const [x, z] of [[9, -2], [-9, 2], [2, 9], [-2, -9], [20, 8], [-20, -8]]) wall(x, z, 1.5, 1.5);
  // vault bunkers (CR): back wall + sides + front wings, per team.
  for (const v of VAULTS) {
    const s = v.z >= 0 ? -1 : 1;               // opening toward mid
    const frontZ = v.z + s * 4, backZ = v.z - s * 4; // D=8 → ±4
    wall(0, backZ, 6, 0.6);                     // W=12 → hx6
    wall(-6, v.z, 0.6, 4); wall(6, v.z, 0.6, 4);
    wall(-3.5, frontZ, 2.5, 0.6); wall(3.5, frontZ, 2.5, 0.6); // gap=5, wingW=3.5
  }

  return {
    id: 'duel', VAULTS, BUY_STATIONS, TEAM_SPAWNS, SPAWNS, WAYPOINTS, LINKS, WALLS,
    vaultAt: vaultAtFactory(VAULTS),
    buyStationAt: buyStationAtFactory(BUY_STATIONS),
  };
}

// =====================================================================
//  Line-of-sight against the map's solid blockers (2D, ground plane)
// =====================================================================

/** True if segment (x0,z0)→(x1,z1) crosses the AABB `b` (Liang–Barsky). */
function segHitsBox(x0, z0, x1, z1, b) {
  const minX = b.x - b.hx, maxX = b.x + b.hx;
  const minZ = b.z - b.hz, maxZ = b.z + b.hz;
  // A shooter/target standing inside (or on) a structure isn't blocked by it.
  const inside = (x, z) => x >= minX && x <= maxX && z >= minZ && z <= maxZ;
  if (inside(x0, z0) || inside(x1, z1)) return false;
  const dx = x1 - x0, dz = z1 - z0;
  let t0 = 0, t1 = 1;
  const edges = [[-dx, x0 - minX], [dx, maxX - x0], [-dz, z0 - minZ], [dz, maxZ - z0]];
  for (const [p, q] of edges) {
    if (p === 0) { if (q < 0) return false; continue; } // parallel & outside slab
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else       { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

/** True if any wall blocks the line from (x0,z0) to (x1,z1) on `map`. */
export function losBlocked(map, x0, z0, x1, z1) {
  const walls = map.WALLS;
  if (!walls) return false;
  for (const b of walls) if (segHitsBox(x0, z0, x1, z1, b)) return true;
  return false;
}

const MAPS = {
  atrium: buildAtrium(),
  duel: buildDuel(),
};

/** Get a map by id, falling back to Foundry Duel (the Cash Raid default). */
export function getMap(mapId) {
  return MAPS[mapId] || MAPS.duel;
}

/** List of all known map ids — used by the server allowlist. */
export const MAP_IDS = Object.keys(MAPS);
