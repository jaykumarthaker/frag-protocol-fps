# CLAUDE.md

Guidance for working in this repo.

## Project

**Frag Protocol** — a browser arena FPS (Three.js + Rapier physics + TypeScript
+ Vite) with two modes:

- **Deathmatch** — free-for-all, original mode.
- **Cash Raid** — team mode: raid the enemy vault for cash, bank it at your own
  vault, spend banked money at buy stations. Steal/deposit, death drops,
  objective bots, win on target or timer.

Both modes play offline (vs. bots) or online. Online runs against an
authoritative Node + ws server that hosts many rooms, each with a pre-match
lobby and a 6-char invite code.

## Commands

```bash
npm install
npm run dev        # Vite dev server (http://localhost:5173)
npm run build      # tsc --noEmit, then vite build → dist/
npm run typecheck  # tsc --noEmit only
npm run preview    # serve the production build

cd server && npm install && npm start   # ws://localhost:2567 (PORT to change)
```

There is no test suite. After any change, run `npm run build` (it type-checks)
and `node --check` the server `.mjs` files. There is no browser test harness;
verify gameplay by running `npm run dev`. The game exposes `window.__game` for
manual smoke tests.

## Architecture

- **`src/core/Game.ts`** — the orchestrator. Owns the renderer/scene, the game
  loop, match lifecycle, the combat API (`hitscan`, `applyDamage`,
  `radialDamage`, `onActorDied`), and all online message handling. `gameMode`
  (`'deathmatch' | 'cashraid'`) and `mode` (`'offline' | 'online'`) gate
  behaviour. Most new gameplay wires through here.
- **`src/game/`** — rules. `Match` (deathmatch) and `CashRaidRules` both
  implement `MatchRules`; `Game.match` holds either. `teams.ts` has team
  helpers (`sameTeam`, `enemyOf`, `TEAM_COLORS`). `shop.ts` is the buy
  catalogue.
- **`src/entities/`** — `Actor` base (player + bots), `Player`, `Bot`,
  `RemotePlayer`; plus Cash Raid `VaultZone`, `BuyStation`, `CashDrop`.
- **`src/arena/`** — two maps: `Arena` (the "Foundry Duel" blockout, used
  directly) and `AtriumArena`. **Every map plays in both modes.** A map's static
  geometry is built in `build()`; the Cash Raid vault bunkers + buy kiosks + team
  spawns are layered on at runtime by `addCashRaidStructures()` (using the base
  helpers `addVaultBunker` / `addKiosk` / `addTeamSpawns`, which populate
  `vaultDefs` / `buyDefs` / `teamSpawns`). `Game.ensureArena` rebuilds on a
  `mode:mapId` key and calls `addCashRaidStructures()` only in Cash Raid.
- **`src/ai/BotBrain.ts`** — perception, A* nav, combat; plus Cash Raid
  raid/carry/defend objectives.
- **`src/net/protocol.ts`** — the wire protocol. Shared in spirit with the
  server but the server is plain JS, so **keep both sides in sync by hand**.
- **`server/`** — `server.mjs` (connections + rooms map), `room.mjs` (one
  room: lobby, authoritative match, Cash Raid money), `botbrain.mjs` (server
  bots), `cashraid-map.mjs` (map data for the server).

## Conventions & invariants

- **Deathmatch must never regress.** Cash Raid code is gated on
  `gameMode === 'cashraid'`. `Actor.team` defaults to `0` ("no team"), which
  all damage code treats as "everyone is an enemy".
- **No friendly fire in Cash Raid.** The rule lives in `sameTeam()` and is
  applied in `applyDamage`, `radialDamage`, their `*Online` variants, and the
  server's `damage()`. Self-damage (rocket jumps) is always kept.
- **The server owns all online money.** Carried cash, team banks, drops,
  deposits and purchases are authoritative on the server. Clients render and
  request only. Offline play simulates the economy client-side in `Game.ts`.
- **`server/cashraid-map.mjs` must match each arena's `addCashRaidStructures()`.**
  The server has no Three.js; the map module is plain data (`[x,y,z]` tuples) with
  one entry per map id (`atrium`, `duel`), each carrying `VAULTS` /
  `BUY_STATIONS` / `TEAM_SPAWNS` / `SPAWNS` (deathmatch) / `WAYPOINTS` / `WALLS`.
  Changing a map's anchors means updating both sides by hand.
- **Cash Raid economy:** the enemy vault is a money *source* — raiding mints
  fresh cash (it does not drain the enemy bank), so banks can climb to the win
  target. See the comment in `CashRaidRules.steal`.
- The shop maps the design doc's weapon names onto the four real weapons by
  price tier; `pulse` is the free starter weapon and is not sold.

## Notes

- `gameplay.txt` is the original Cash Raid design doc (the brief, not a spec).
- Deferred from that doc: Most Wanted / minimap, defensive upgrades, classes,
  ranked, dynamic events.
- End git commit messages with the required `Co-Authored-By` trailer.
