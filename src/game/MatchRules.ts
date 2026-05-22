import type { Actor } from '../entities/Actor';
import type { MatchConfig } from '../core/types';

/**
 * Common surface the game loop + HUD consume, satisfied by both the
 * deathmatch `Match` and the `CashRaidRules`. Lets `Game.match` hold either.
 */
export interface MatchRules {
  config: MatchConfig;
  timeLeft: number;
  over: boolean;
  /** Advance the clock / rules; returns true on the frame the match ends. */
  update(dt: number, actors: Actor[]): boolean;
  /** Actors sorted best-first for the scoreboard / end screen. */
  ranking(actors: Actor[]): Actor[];
}
