/**
 * Wire protocol for online play — shared shapes between the browser client
 * and `server/server.mjs`. JSON over WebSocket. Keep both sides in sync.
 *
 * Flow: connect → create/join a room → pre-match lobby → match. Deathmatch
 * and Cash Raid both run inside a room; Cash Raid money is server-authoritative.
 */
import type { GameMode, Team } from '../core/types';

/** A player as broadcast by the server. */
export interface NetPlayer {
  id: number;
  name: string;
  color: number;
  team: Team;
  isBot: boolean;
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
  /** Cash Raid: money currently carried + career totals (for the scoreboard). */
  carried: number;
  moneyBanked: number;
  moneyStolen: number;
  /** Character model id (registry key in `core/Models.ts`). */
  character: string;
}

export interface NetMatch {
  mode: GameMode;
  timeLeft: number;
  over: boolean;
  fragLimit: number;
  /** Deathmatch winner id (0 = none). */
  winnerId: number;
  /** Cash Raid: per-team banks, win target and winning team. */
  bank1: number;
  bank2: number;
  winTarget: number;
  winnerTeam: Team;
}

/** Host-configurable room settings. */
export interface LobbyConfig {
  mode: GameMode;
  maxPlayers: number;
  durationSec: number;
  botCount: number;
  fragLimit: number;
  difficulty: 'rookie' | 'skilled' | 'deadly';
  startMoney: number;
  winTarget: number;
  isPublic: boolean;
}

/** One member of a pre-match lobby. */
export interface LobbyMember {
  id: number;
  name: string;
  team: Team;
  ready: boolean;
  isHost: boolean;
  isBot: boolean;
  character: string;
}

/** Full pre-match lobby state, re-broadcast on any change. */
export interface LobbyState {
  code: string;
  hostId: number;
  phase: 'lobby' | 'playing';
  config: LobbyConfig;
  members: LobbyMember[];
}

// ---- server -> client ----
export type ServerMsg =
  | { t: 'roomJoined'; code: string; youId: number; host: boolean }
  | { t: 'lobbyState'; lobby: LobbyState }
  | { t: 'roomError'; message: string }
  | { t: 'kicked' }
  | { t: 'matchStart'; youId: number; players: NetPlayer[]; match: NetMatch }
  | { t: 'state'; players: NetPlayer[]; match: NetMatch }
  | { t: 'playerLeft'; id: number }
  | {
      t: 'fire'; id: number; weapon: string; alt: boolean;
      ox: number; oy: number; oz: number; dx: number; dy: number; dz: number;
    }
  | { t: 'kill'; killerId: number; victimId: number; weapon: string; headshot: boolean }
  | { t: 'spawn'; id: number; x: number; y: number; z: number }
  | { t: 'matchOver'; winnerId: number; winnerTeam: Team }
  | { t: 'matchReset'; match: NetMatch }
  // ---- Cash Raid ----
  | { t: 'cashSpawned'; dropId: number; x: number; y: number; z: number; amount: number }
  | { t: 'cashCollected'; dropId: number; byId: number; amount: number }
  | { t: 'cashExpired'; dropId: number }
  | { t: 'bankUpdate'; bank1: number; bank2: number }
  | { t: 'loadoutUpdate'; weapons: string[]; armor: number }
  | { t: 'cashEvent'; text: string };

// ---- client -> server ----
export type ClientMsg =
  | { t: 'createRoom'; name: string; config: LobbyConfig; character?: string }
  | { t: 'joinRoom'; code: string; name: string; character?: string }
  | { t: 'lobbySetCharacter'; character: string }
  | { t: 'leaveRoom' }
  | { t: 'lobbySetReady'; ready: boolean }
  | { t: 'lobbySelectTeam'; team: Team }
  | { t: 'lobbyConfig'; config: LobbyConfig }
  | { t: 'lobbyKick'; id: number }
  | { t: 'lobbyStart' }
  | {
      t: 'input';
      x: number; y: number; z: number;
      yaw: number; pitch: number;
      vx: number; vy: number; vz: number;
      weapon: string; anim: string;
      /** Cash Raid: holding the interact key (server runs the vault channel). */
      interact: boolean;
    }
  | {
      t: 'fire'; weapon: string; alt: boolean;
      ox: number; oy: number; oz: number; dx: number; dy: number; dz: number;
    }
  | { t: 'hit'; targetId: number; amount: number; weapon: string; headshot: boolean }
  | { t: 'buy'; itemId: string };
