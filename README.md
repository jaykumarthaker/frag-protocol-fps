# FRAG PROTOCOL

A browser-based **arena first-person shooter** — a homage to early-2000s
tournament FPS (Unreal Tournament 2003 and friends), running entirely in the
browser with no plugins and no install. Single-player vs. AI bots **and**
online multiplayer deathmatch.

> **What this is.** An *original* game inspired by the UT2003 *experience* —
> fast dodge/double-jump movement, arena deathmatch, shock/rocket/flak weapon
> archetypes, an announcer, AI bots. It is **not** Unreal Tournament 2003 and
> ships none of that game's code, engine or assets — those are Epic Games'
> property. Like the "play Counter-Strike in your browser" sites, this is a
> *recreation* of the genre, not the original game. Names are original.

Built with **Three.js** (WebGL + bloom), **Rapier** (WASM physics),
TypeScript and Vite. Online play uses a small authoritative **Node + ws**
server.

## Play it

```bash
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>). From the menu:

- **Enter Arena** — offline deathmatch vs. AI bots.
- **Play Online** — connect to a server for live multiplayer (see below).

Click the canvas to lock the mouse.

### Controls

| Action            | Input                                   |
|-------------------|-----------------------------------------|
| Move              | `W` `A` `S` `D`                         |
| Jump / double-jump| `Space` (tap twice in the air)          |
| Dodge             | double-tap a movement key               |
| Aim               | Mouse                                   |
| Fire / alt-fire   | Left click / Right click                |
| Switch weapon     | `1`–`4`, mouse wheel, or `Q`            |
| Scoreboard        | hold `Tab`                              |
| Pause             | `Esc`                                   |

### Weapons

| Slot | Weapon          | Primary                         | Alt-fire                       |
|------|-----------------|---------------------------------|--------------------------------|
| 1    | Railgun         | instant-hit sniper, 2× headshots| —                              |
| 2    | Shard Cannon    | 9-pellet flak spread            | heavy explosive chunk          |
| 3    | Rocket Launcher | splash rocket (rocket-jump!)    | —                              |
| 4    | Pulse Rifle     | rapid beam                      | plasma orb — **beam an orb for the combo blast** |

## Multiplayer

Online deathmatch runs against a small authoritative server.

```bash
cd server
npm install
npm start            # ws://localhost:2567  (set PORT to change)
```

Then in the game choose **Play Online**, enter a callsign, point it at
`ws://localhost:2567` and connect. Open the game in another tab/machine to
join the same arena.

- Clients simulate their own player locally (responsive) and report
  transforms ~20 Hz; remote players are interpolated between snapshots.
- The server is **authoritative** for health, kills, scores and the match
  clock, so every client agrees on damage and standings.
- Players-only deathmatch (no bots / pickups online in this version).

See [server/README.md](server/README.md) for hosting notes.

## Build & deploy

```bash
npm run build      # type-checks, then bundles to dist/
npm run preview    # serve the production build locally
```

`dist/` is a static site — host it anywhere (Netlify, Vercel, GitHub Pages,
itch.io). `vite.config.ts` uses `base: './'` so it works from any sub-path.
A GitHub Pages workflow is included at
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — push to
`main`, enable Pages (*Settings → Pages → Source: GitHub Actions*), and the
site builds and deploys automatically. (The online server is a separate Node
process — host it wherever long-running WebSockets are allowed.)

## Project structure

```
src/
  core/      Game orchestrator, input, look math, model loading, types
  physics/   Rapier world + character controller wrapper
  arena/     procedural blockout arena (geometry, jump pads, AI waypoints)
  entities/  Actor base, Player, Bot, RemotePlayer, Projectile, Pickup
  weapons/   weapon data + firing system (hitscan / pellets / projectiles)
  ai/        BotBrain (perception, A* navigation, combat) + nav graph
  audio/     procedural Web Audio SFX + speech-synthesis announcer
  effects/   transient visual FX (tracers, beams, explosions)
  net/       online protocol + WebSocket client
  ui/        HUD overlay + menus
  game/      Match (deathmatch rules)
server/      authoritative online game server (Node + ws)
```

## Assets

The only bundled third-party asset is a **CC0 (public-domain) character
model** (`RobotExpressive`); every other mesh, texture and sound is generated
procedurally at runtime. See [ASSETS.md](ASSETS.md) for the full log and
licensing.

## Status & roadmap

Done: arena movement, 4 weapons, AI bots, deathmatch, HUD/menus, procedural
audio + announcer, an art pass (animated characters, bloom, environment) and
online multiplayer.

Possible next steps: client-side prediction for lower-latency online play,
server-side pickups/power-ups, more maps and game modes (Team DM, CTF), and a
proper environment-art pass with CC0 modular kits.

## Credits

Engine libraries: [Three.js](https://threejs.org) (MIT),
[Rapier](https://rapier.rs) (Apache-2.0), [ws](https://github.com/websockets/ws)
(MIT). Character model "RobotExpressive" by Tomás Laulhé / Don McCurdy (CC0).
Everything else is original. Not affiliated with Epic Games.
