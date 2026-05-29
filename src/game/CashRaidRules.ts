import type { Actor } from '../entities/Actor';
import type { MatchConfig, Team } from '../core/types';
import type { MatchRules } from './MatchRules';

/** Cash a single raid of the enemy vault extracts onto the raider. */
export const STEAL_PER_TAP = 2500;

/**
 * Cash Raid scoring: two team banks, fed by depositing carried money. A team
 * wins by reaching the win target, or by holding the larger bank when time
 * expires. Per-player career stats live on the Actor.
 */
export class CashRaidRules implements MatchRules {
  config: MatchConfig;
  timeLeft: number;
  over = false;
  /** Winning team once `over` (0 = draw). */
  winner: Team = 0;
  /** Banked money per team. */
  bank: Record<number, number> = { 1: 0, 2: 0 };
  winTarget: number;

  constructor(config: MatchConfig) {
    this.config = config;
    this.timeLeft = config.timeLimitSec;
    this.winTarget = config.winTarget ?? 100000;
    const start = config.startMoney ?? 0;
    this.bank[1] = start;
    this.bank[2] = start;
  }

  /** Advance the clock; returns true on the frame the match ends. */
  update(dt: number, _actors: Actor[]): boolean {
    if (this.over) return false;
    this.timeLeft -= dt;
    return this.evaluateWin();
  }

  /** Resolve win conditions; returns true on the ending frame. */
  evaluateWin(): boolean {
    if (this.over) return false;
    const hitTarget = this.bank[1] >= this.winTarget || this.bank[2] >= this.winTarget;
    if (hitTarget || this.timeLeft <= 0) {
      this.timeLeft = Math.max(0, this.timeLeft);
      this.over = true;
      this.winner = this.bank[1] === this.bank[2] ? 0 : this.bank[1] > this.bank[2] ? 1 : 2;
      return true;
    }
    return false;
  }

  /** Bank a carrier's money into their team's vault. Returns the amount. */
  deposit(actor: Actor): number {
    const amt = Math.floor(actor.carried);
    if (amt <= 0 || actor.team === 0) return 0;
    this.bank[actor.team] += amt;
    actor.carried = 0;
    actor.moneyBanked += amt;
    return amt;
  }

  /**
   * Raid the enemy vault — extracts a single fixed haul of cash onto the
   * raider. You can only raid while carrying nothing: one raid grants exactly
   * STEAL_PER_TAP and you must bank it before raiding again (so a raider can't
   * camp the vault and stack an unlimited haul). The vault is a money source —
   * the loot is fresh, not drawn from a bank — so banks can climb to the win
   * target. Recovered death-drops may push `carried` above the cap; that's
   * intentional (loot, not minted).
   */
  steal(actor: Actor, amount = STEAL_PER_TAP): number {
    if (actor.team === 0 || actor.carried > 0) return 0;
    actor.carried += amount;
    actor.moneyStolen += amount;
    return amount;
  }

  /** Actors sorted by total money handled (banked + stolen), best first. */
  ranking(actors: Actor[]): Actor[] {
    return [...actors].sort(
      (a, b) => (b.moneyBanked + b.moneyStolen) - (a.moneyBanked + a.moneyStolen),
    );
  }
}
