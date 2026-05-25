/**
 * Server-side Cash Raid map registry. Each entry packs everything the room
 * and the bot brain need to know about the layout (vault zones, buy stations,
 * team spawns and a waypoint graph). Coordinates here mirror the matching
 * client arena under src/arena/; keep them in sync by hand.
 *
 * The room receives a `mapId` in its config and looks up the matching entry
 * via `getMap(mapId)`. Bot helpers (`nearestWp`, `findPath`) take the map as
 * a parameter so different rooms can run different geometries simultaneously.
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
//  Map: 'cashraid' — Vault Standoff (the original wide arena)
//  Mirrors src/arena/CashRaidArena.ts.
// =====================================================================
function buildVaultStandoff() {
  const BASE_Z = 44;
  const VAULTS = [1, 2].map((team) => {
    const [x, z] = mir(team, -14, -BASE_Z);
    return { team, x, y: 0, z, hx: 6.4, hy: 3.0, hz: 3.9 };
  });
  const BUY_STATIONS = [1, 2].map((team) => {
    const [x, z] = mir(team, 16, -BASE_Z + 2);
    return { team, x, y: 0, z, radius: 5.5 };
  });
  const TEAM_SPAWNS = { 1: [], 2: [] };
  for (const team of [1, 2]) {
    for (const lx of [-20, -8, 4, 16]) {
      const [x, z] = mir(team, lx, -BASE_Z - 6);
      TEAM_SPAWNS[team].push([x, 0.05, z]);
    }
  }
  const WAYPOINTS = [];
  const wp = (team, x, z, y = 0) => {
    const [wx, wz] = mir(team, x, z);
    WAYPOINTS.push([wx, y, wz]);
  };
  for (const team of [1, 2]) {
    wp(team, -14, -BASE_Z);
    wp(team, -14, -36);
    wp(team, 16, -42);
    wp(team, 0, -34);
    wp(team, 36, -24);
    wp(team, -36, -24);
  }
  for (const [x, z] of [
    [38, 0], [-38, 0], [22, 18], [-22, 18], [22, -18], [-22, -18],
    [0, 24], [0, -24], [38, 18], [-38, -18], [38, -18], [-38, 18],
  ]) WAYPOINTS.push([x, 0, z]);
  WAYPOINTS.push([0, 5, 0], [7, 5, 7], [-7, 5, -7], [7, 5, -7], [-7, 5, 7]);
  const LINKS = autoLink(WAYPOINTS, 24);

  return {
    id: 'cashraid', VAULTS, BUY_STATIONS, TEAM_SPAWNS, WAYPOINTS, LINKS,
    vaultAt: vaultAtFactory(VAULTS),
    buyStationAt: buyStationAtFactory(BUY_STATIONS),
  };
}

// =====================================================================
//  Map: 'vaultyard' — Vault Yard (compact, close-quarters)
//  Mirrors src/arena/VaultYardArena.ts.
// =====================================================================
function buildVaultYard() {
  // Smaller footprint, vaults pushed closer to mid for a brawl-pace map.
  const BASE_Z = 32;
  const VAULTS = [1, 2].map((team) => {
    const [x, z] = mir(team, 0, -BASE_Z);
    return { team, x, y: 0, z, hx: 5.4, hy: 3.0, hz: 3.4 };
  });
  const BUY_STATIONS = [1, 2].map((team) => {
    const [x, z] = mir(team, -18, -BASE_Z + 1);
    return { team, x, y: 0, z, radius: 5.0 };
  });
  const TEAM_SPAWNS = { 1: [], 2: [] };
  for (const team of [1, 2]) {
    for (const lx of [-12, -4, 4, 12]) {
      const [x, z] = mir(team, lx, -BASE_Z - 5);
      TEAM_SPAWNS[team].push([x, 0.05, z]);
    }
  }
  const WAYPOINTS = [];
  const wp = (team, x, z, y = 0) => {
    const [wx, wz] = mir(team, x, z);
    WAYPOINTS.push([wx, y, wz]);
  };
  for (const team of [1, 2]) {
    wp(team, 0, -BASE_Z);          // vault
    wp(team, 0, -BASE_Z + 6);      // vault mouth
    wp(team, -18, -BASE_Z + 1);    // buy station
    wp(team, 0, -BASE_Z + 14);     // base mouth
    wp(team,  18, -BASE_Z + 8);    // right flank in
    wp(team, -18, -BASE_Z + 14);   // left lane forward
  }
  // Mid-field corridor + flank nodes
  for (const [x, z] of [
    [0, 0], [10, 0], [-10, 0],
    [22, 10], [-22, 10], [22, -10], [-22, -10],
    [0, 12], [0, -12],
  ]) WAYPOINTS.push([x, 0, z]);
  const LINKS = autoLink(WAYPOINTS, 20);

  return {
    id: 'vaultyard', VAULTS, BUY_STATIONS, TEAM_SPAWNS, WAYPOINTS, LINKS,
    vaultAt: vaultAtFactory(VAULTS),
    buyStationAt: buyStationAtFactory(BUY_STATIONS),
  };
}

const MAPS = {
  cashraid: buildVaultStandoff(),
  vaultyard: buildVaultYard(),
};

/** Get a map by id, falling back to the default Vault Standoff. */
export function getMap(mapId) {
  return MAPS[mapId] || MAPS.cashraid;
}

/** List of all known Cash Raid map ids — used by the server allowlist. */
export const MAP_IDS = Object.keys(MAPS);
