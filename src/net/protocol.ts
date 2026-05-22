/**
 * Wire protocol for online play — shared shapes between the browser client
 * and `server/server.mjs`. JSON over WebSocket. Keep both sides in sync.
 */

/** A player as broadcast by the server. */
export interface NetPlayer {
  id: number;
  name: string;
  color: number;
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  weapon: string;
  anim: string;
  health: number;
  armor: number;
  alive: boolean;
  frags: number;
  deaths: number;
}

export interface NetMatch {
  timeLeft: number;
  over: boolean;
  fragLimit: number;
  winnerId: number;
}

// ---- server -> client ----
export type ServerMsg =
  | { t: 'welcome'; id: number; players: NetPlayer[]; match: NetMatch }
  | { t: 'state'; players: NetPlayer[]; match: NetMatch }
  | { t: 'playerJoined'; player: NetPlayer }
  | { t: 'playerLeft'; id: number }
  | {
      t: 'fire'; id: number; weapon: string; alt: boolean;
      ox: number; oy: number; oz: number; dx: number; dy: number; dz: number;
    }
  | { t: 'kill'; killerId: number; victimId: number; weapon: string; headshot: boolean }
  | { t: 'spawn'; id: number; x: number; y: number; z: number }
  | { t: 'matchOver'; winnerId: number }
  | { t: 'matchReset'; match: NetMatch };

// ---- client -> server ----
export type ClientMsg =
  | { t: 'join'; name: string }
  | {
      t: 'input';
      x: number; y: number; z: number;
      yaw: number; pitch: number;
      vx: number; vy: number; vz: number;
      weapon: string; anim: string;
    }
  | {
      t: 'fire'; weapon: string; alt: boolean;
      ox: number; oy: number; oz: number; dx: number; dy: number; dz: number;
    }
  | { t: 'hit'; targetId: number; amount: number; weapon: string; headshot: boolean };
