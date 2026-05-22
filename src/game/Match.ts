import type { Actor } from '../entities/Actor';
import type { MatchConfig } from '../core/types';

/**
 * Deathmatch rules: first to the frag limit (or the highest score when the
 * time limit runs out) wins. Per-actor scores live on the Actor itself.
 */
export class Match {
  config: MatchConfig;
  timeLeft: number;
  over = false;
  winner: Actor | null = null;

  constructor(config: MatchConfig) {
    this.config = config;
    this.timeLeft = config.timeLimitSec;
  }

  /** Advance the clock; returns true on the frame the match ends. */
  update(dt: number, actors: Actor[]): boolean {
    if (this.over) return false;
    this.timeLeft -= dt;

    const leader = this.leader(actors);
    const reachedLimit = leader != null && leader.frags >= this.config.fragLimit;
    if (reachedLimit || this.timeLeft <= 0) {
      this.timeLeft = Math.max(0, this.timeLeft);
      this.over = true;
      this.winner = leader;
      return true;
    }
    return false;
  }

  leader(actors: Actor[]): Actor | null {
    let best: Actor | null = null;
    for (const a of actors) {
      if (!best || a.frags > best.frags) best = a;
    }
    return best;
  }

  /** Actors sorted by score (descending), with deaths as a tiebreak. */
  ranking(actors: Actor[]): Actor[] {
    return [...actors].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
  }
}
