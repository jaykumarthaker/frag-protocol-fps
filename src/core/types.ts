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

/** Match configuration chosen from the menu. */
export interface MatchConfig {
  botCount: number;
  fragLimit: number;
  timeLimitSec: number;
  difficulty: 'rookie' | 'skilled' | 'deadly';
}

export type GameState = 'menu' | 'playing' | 'paused' | 'matchover';
