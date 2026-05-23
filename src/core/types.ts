import type * as THREE from 'three';
import type { Actor } from '../entities/Actor';

/** Information about a single damage event applied to an Actor. */
export interface DamageInfo {
  amount: number;
  attacker: Actor | null;
  weaponId: string;
  headshot: boolean;
  point: THREE.Vector3;
  /** Velocity impulse applied to the victim (rocket knockback, etc.). */
  knockback: THREE.Vector3 | null;
  splash: boolean;
}

/** Result of a hitscan ray against the world + actors. */
export interface HitscanResult {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  /** Actor struck, or null if the ray hit world geometry / nothing. */
  actor: Actor | null;
  headshot: boolean;
  distance: number;
}

/** Which set of rules a match runs. */
export type GameMode = 'deathmatch' | 'cashraid';

/**
 * Team allegiance. 0 = none (deathmatch — everyone is an enemy); 1/2 are the
 * two Cash Raid teams. Kept numeric so it is cheap on the wire.
 */
export type Team = 0 | 1 | 2;

/** Match configuration chosen from the menu / lobby. */
export interface MatchConfig {
  mode: GameMode;
  botCount: number;
  fragLimit: number;
  timeLimitSec: number;
  difficulty: 'rookie' | 'skilled' | 'deadly';
  /** Cash Raid: money each team's bank starts with. */
  startMoney?: number;
  /** Cash Raid: bank total that triggers an instant win. */
  winTarget?: number;
  /** Map id from the registry in `arena/MapRegistry.ts`. */
  mapId?: string;
}

export type GameState = 'menu' | 'playing' | 'paused' | 'matchover';
