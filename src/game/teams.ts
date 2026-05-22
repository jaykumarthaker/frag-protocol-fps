import type { Team } from '../core/types';
import type { Actor } from '../entities/Actor';

/**
 * Team identity for Cash Raid. Team 0 is "no team" (deathmatch); teams 1 and 2
 * are the two raiding sides. All team-aware gameplay funnels through the
 * helpers here so the rules live in one place.
 */

/** Display colour per team (also used to tint robot models / name tags). */
export const TEAM_COLORS: Record<Team, number> = {
  0: 0x36e0ff, // unused in deathmatch, kept for completeness
  1: 0x36e0ff, // BLUE
  2: 0xff7a18, // ORANGE
};

/** Short human-readable team name. */
export function teamName(t: Team): string {
  return t === 1 ? 'BLUE' : t === 2 ? 'ORANGE' : 'NONE';
}

/** The opposing team (only meaningful for teams 1 / 2). */
export function enemyOf(t: Team): Team {
  return t === 1 ? 2 : t === 2 ? 1 : 0;
}

/**
 * True when two actors are teammates. Team 0 never counts as "same team", so
 * deathmatch keeps full friendly fire and existing behaviour is unchanged.
 */
export function sameTeam(a: Actor, b: Actor): boolean {
  return a.team !== 0 && a.team === b.team;
}
