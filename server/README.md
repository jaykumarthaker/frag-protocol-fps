# Frag Protocol — Game Server

Authoritative WebSocket server for online deathmatch.

```bash
cd server
npm install
npm start          # listens on ws://localhost:2567  (set PORT to change)
```

Then in the game, open **Play Online**, point it at `ws://localhost:2567`
(the default) and join.

## Model

- Clients simulate their own player locally and report transforms ~20 Hz.
- The server is **authoritative** for health, kills, scores and the match
  clock; hits are reported by the firing client and applied server-side, so
  all clients agree on damage and standings.
- Players-only deathmatch — no bots or pickups in this version.

## Deploying

The server is a plain Node app — host it on any platform that allows a
long-running WebSocket process (Fly.io, Railway, Render, a VPS, etc.). Use
`wss://` behind TLS in production and point the client's server URL at it.
