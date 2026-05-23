import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Bot } from '../entities/Bot';
import type { Actor } from '../entities/Actor';
import type { MatchConfig } from '../core/types';
import { lookDir } from '../core/look';
import { findPath, nearestWaypoint } from './nav';
import { WEAPONS } from '../weapons/Weapons';

export interface BotIntent {
  wishDir: THREE.Vector3;
  jump: boolean;
  dodge: THREE.Vector3 | null;
}

interface DiffParams {
  aimError: number;
  aimLerp: number;
  reaction: number;
  fireAngle: number;
}

const DIFFICULTY: Record<MatchConfig['difficulty'], DiffParams> = {
  rookie:  { aimError: 0.14,  aimLerp: 5,  reaction: 0.55, fireAngle: 0.17 },
  skilled: { aimError: 0.06,  aimLerp: 9,  reaction: 0.30, fireAngle: 0.11 },
  deadly:  { aimError: 0.025, aimLerp: 17, reaction: 0.14, fireAngle: 0.07 },
};

type State = 'roam' | 'combat' | 'hunt';
type BotRole = 'attacker' | 'defender';

/**
 * Bot intelligence: perception (line-of-sight scans), waypoint navigation
 * (A*), target engagement (strafe / approach / dodge), difficulty-scaled
 * aiming with projectile lead, and weapon selection by range.
 */
export class BotBrain {
  private bot: Bot;
  private game: Game;
  private p: DiffParams;

  private state: State = 'roam';
  /** Cash Raid disposition — roughly one defender per three bots. */
  private role: BotRole = Math.random() < 0.34 ? 'defender' : 'attacker';
  /** Set each frame: true when the bot wants to channel a vault interaction. */
  wantInteract = false;
  private target: Actor | null = null;
  private targetAcquiredAt = 0;
  private lastSeenAt = -99;
  private lastSeenPos = new THREE.Vector3();

  private path: THREE.Vector3[] = [];
  private pathIndex = 0;
  private repathAt = 0;
  private nextScanAt = 0;
  private nextWeaponPickAt = 0;
  private nextDodgeAt = 0;
  private nextJumpAt = 0;
  private nextWobbleAt = 0;
  private strafeSign = Math.random() < 0.5 ? 1 : -1;
  private strafeFlipAt = 0;

  private aimWobble = new THREE.Vector3();
  private desiredYaw = 0;
  private desiredPitch = 0;

  private stuckPos = new THREE.Vector3();
  private stuckTimer = 0;

  constructor(bot: Bot, game: Game, difficulty: MatchConfig['difficulty']) {
    this.bot = bot;
    this.game = game;
    this.p = DIFFICULTY[difficulty];
    this.desiredYaw = bot.yaw;
    this.stuckPos.copy(bot.position);
    this.nextScanAt = game.time + Math.random() * 0.2;
  }

  update(dt: number): BotIntent {
    const g = this.game;
    const bot = this.bot;

    if (g.time >= this.nextScanAt) {
      this.nextScanAt = g.time + 0.12 + Math.random() * 0.12;
      this.acquireTarget();
    }
    if (g.time >= this.nextWeaponPickAt) {
      this.nextWeaponPickAt = g.time + 1.6 + Math.random();
      this.pickWeapon();
    }
    if (g.time >= this.nextWobbleAt) {
      this.nextWobbleAt = g.time + 0.35;
      this.aimWobble.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(this.p.aimError * 2);
    }

    // resolve state
    if (this.target && this.target.alive) {
      if (this.canSee(this.target)) {
        this.lastSeenAt = g.time;
        this.lastSeenPos.copy(this.target.position);
        this.state = 'combat';
      } else if (g.time - this.lastSeenAt > 2.6) {
        this.target = null;
        this.state = 'roam';
      } else {
        this.state = 'hunt';
      }
    } else {
      this.target = null;
      this.state = 'roam';
    }

    this.wantInteract = false;
    let intent: BotIntent;
    switch (this.state) {
      case 'combat': intent = this.combat(dt); break;
      case 'hunt':   intent = this.hunt(); break;
      default:
        intent = g.gameMode === 'cashraid' ? this.objectiveRoam() : this.roam(g.time);
        break;
    }

    this.steerAim(dt);
    this.handleStuck(dt, intent);
    return intent;
  }

  // ---- perception -----------------------------------------------------

  private acquireTarget() {
    let best: Actor | null = null;
    let bestD = Infinity;
    for (const a of this.game.actors) {
      if (a === this.bot || !a.alive) continue;
      const d = this.bot.position.distanceTo(a.position);
      if (d < bestD && this.canSee(a)) { bestD = d; best = a; }
    }
    if (best && best !== this.target) {
      this.target = best;
      this.targetAcquiredAt = this.game.time;
    } else if (best) {
      this.target = best;
    }
  }

  private canSee(other: Actor): boolean {
    const from = this.bot.eyePosition();
    const to = other.eyePosition();
    const d = to.clone().sub(from);
    const dist = d.length();
    if (dist > 130) return false;
    if (dist < 0.001) return true;
    d.multiplyScalar(1 / dist);
    return !this.game.physics.raycastWorld(from, d, dist - 0.4);
  }

  // ---- behaviours -----------------------------------------------------

  private combat(dt: number): BotIntent {
    const bot = this.bot;
    const target = this.target!;
    const toT = target.position.clone().sub(bot.position);
    toT.y = 0;
    const dist = toT.length() || 0.001;
    toT.multiplyScalar(1 / dist);
    const right = new THREE.Vector3(toT.z, 0, -toT.x);

    // keep mid range: approach if far, back off if too close
    let approach = 0;
    if (dist > 22) approach = 1;
    else if (dist < 9) approach = -1;

    if (this.game.time >= this.strafeFlipAt) {
      this.strafeFlipAt = this.game.time + 1.0 + Math.random() * 1.6;
      this.strafeSign = Math.random() < 0.5 ? 1 : -1;
    }

    const wishDir = new THREE.Vector3()
      .addScaledVector(toT, approach)
      .addScaledVector(right, this.strafeSign * 0.85);

    // Cash Raid: a money carrier fights its way home rather than holding ground
    if (this.game.gameMode === 'cashraid' && bot.carried > 0) {
      const home = this.game.vaults.find((v) => v.team === bot.team);
      if (home) {
        const toHome = home.center.clone().sub(bot.position).setY(0);
        if (toHome.lengthSq() > 1e-4) wishDir.addScaledVector(toHome.normalize(), 1.2);
      }
    }

    // dodge: periodically, or reactively when recently hit
    let dodge: THREE.Vector3 | null = null;
    const hitRecently = this.game.time - bot.lastDamagedAt < 0.25;
    if (this.game.time >= this.nextDodgeAt || hitRecently) {
      this.nextDodgeAt = this.game.time + 1.0 + Math.random() * 1.8;
      dodge = right.clone().multiplyScalar(this.strafeSign);
    }
    let jump = false;
    if (this.game.time >= this.nextJumpAt) {
      this.nextJumpAt = this.game.time + 1.5 + Math.random() * 2.5;
      jump = Math.random() < 0.5;
    }

    this.aimAt(target, dist);
    this.tryFire(target, dist);
    return { wishDir, jump, dodge };
  }

  private hunt(): BotIntent {
    const wishDir = this.dirTo(this.lastSeenPos);
    this.desiredYaw = Math.atan2(-wishDir.x, -wishDir.z);
    this.desiredPitch = 0;
    return { wishDir, jump: false, dodge: null };
  }

  private roam(time: number): BotIntent {
    if (this.path.length === 0 || this.pathIndex >= this.path.length || time >= this.repathAt) {
      this.chooseDestination();
    }
    return this.followPath(time);
  }

  /** Walk the current path; falls back to a gentle wander when path-less. */
  private followPath(time: number): BotIntent {
    if (this.path.length === 0) {
      const a = (time * 0.3 + this.bot.position.x) % (Math.PI * 2);
      const wishDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      this.desiredYaw = Math.atan2(-wishDir.x, -wishDir.z);
      return { wishDir, jump: false, dodge: null };
    }
    const node = this.path[this.pathIndex];
    if (this.bot.position.distanceTo(node) < 2.4) {
      this.pathIndex++;
      if (this.pathIndex >= this.path.length) this.path = [];
      return { wishDir: new THREE.Vector3(), jump: false, dodge: null };
    }
    const wishDir = this.dirTo(node);
    this.desiredYaw = Math.atan2(-wishDir.x, -wishDir.z);
    this.desiredPitch = 0;
    return { wishDir, jump: false, dodge: null };
  }

  private chooseDestination() {
    const arena = this.game.arena;
    let dest: THREE.Vector3;
    const strategic = this.game.pickups.filter((p) => p.strategic);
    if (strategic.length > 0 && Math.random() < 0.55) {
      dest = strategic[(Math.random() * strategic.length) | 0].pos;
    } else {
      dest = arena.waypoints[(Math.random() * arena.waypoints.length) | 0];
    }
    this.pathToward(dest);
  }

  /** A* a path to a specific world position. */
  private pathToward(dest: THREE.Vector3) {
    const arena = this.game.arena;
    const start = nearestWaypoint(arena.waypoints, this.bot.position);
    const goal = nearestWaypoint(arena.waypoints, dest);
    const idx = findPath(arena.waypoints, arena.waypointLinks, start, goal);
    this.path = idx.map((i) => arena.waypoints[i].clone());
    if (this.path.length > 0) this.path.push(dest.clone());
    else this.path = [dest.clone()];
    this.pathIndex = 0;
    this.repathAt = this.game.time + 8;
  }

  /** Cash Raid roam: pursue the bot's objective (raid / carry / defend). */
  private objectiveRoam(): BotIntent {
    const g = this.game;
    const bot = this.bot;
    const ownVault = g.vaults.find((v) => v.team === bot.team) ?? null;
    const enemyVault = g.vaults.find((v) => v.team !== bot.team) ?? null;

    let targetVault = ownVault;
    let interactHere = false;
    if (bot.carried >= 1) {
      // carry the money home and bank it
      targetVault = ownVault;
      interactHere = !!ownVault && ownVault.containsActor(bot);
    } else if (this.role === 'defender') {
      // guard the home vault; patrol around it, never interact
      targetVault = ownVault;
      if (ownVault && bot.position.distanceTo(ownVault.center) < 9) {
        return this.roam(g.time);
      }
    } else {
      // raid the enemy vault for cash
      targetVault = enemyVault;
      interactHere = !!enemyVault && enemyVault.containsActor(bot);
    }

    if (interactHere && targetVault) {
      this.wantInteract = true;
      const d = this.dirTo(targetVault.center);
      if (d.lengthSq() > 1e-4) this.desiredYaw = Math.atan2(-d.x, -d.z);
      return { wishDir: new THREE.Vector3(), jump: false, dodge: null };
    }

    if (!targetVault) return this.roam(g.time);
    if (
      this.path.length === 0 || this.pathIndex >= this.path.length ||
      g.time >= this.repathAt
    ) {
      this.pathToward(targetVault.center);
    }
    return this.followPath(g.time);
  }

  // ---- aiming + firing ------------------------------------------------

  private aimAt(target: Actor, dist: number) {
    const aimPoint = target.eyePosition();
    // lead the target for projectile weapons
    const weapon = WEAPONS[this.bot.currentWeapon];
    if (weapon.primary.kind === 'projectile') {
      const speed = weapon.primary.projectileSpeed ?? 40;
      const travel = dist / speed;
      aimPoint.addScaledVector(target.velocity, travel * 0.9);
    }
    aimPoint.addScaledVector(this.aimWobble, dist);

    const dir = aimPoint.sub(this.bot.eyePosition()).normalize();
    this.desiredYaw = Math.atan2(-dir.x, -dir.z);
    this.desiredPitch = THREE.MathUtils.clamp(Math.asin(dir.y), -1.4, 1.4);
  }

  private tryFire(target: Actor, dist: number) {
    if (this.game.time - this.targetAcquiredAt < this.p.reaction) return;
    if (!this.bot.canFire()) return;
    // don't rocket yourself in the face
    if (this.bot.currentWeapon === 'rocket' && dist < 6) return;

    const look = lookDir(this.bot.yaw, this.bot.pitch);
    const toTarget = target.eyePosition().sub(this.bot.eyePosition()).normalize();
    if (look.dot(toTarget) < Math.cos(this.p.fireAngle)) return;

    this.game.weapons.fire(this.bot, false);
  }

  private steerAim(dt: number) {
    const t = 1 - Math.exp(-this.p.aimLerp * dt);
    this.bot.yaw += shortAngle(this.bot.yaw, this.desiredYaw) * t;
    this.bot.pitch += (this.desiredPitch - this.bot.pitch) * t;
  }

  // ---- helpers --------------------------------------------------------

  private pickWeapon() {
    const dist = this.target ? this.bot.position.distanceTo(this.target.position) : 30;
    let pref: string[];
    if (dist < 13) pref = ['shard', 'pulse', 'rocket', 'railgun'];
    else if (dist < 38) pref = ['rocket', 'pulse', 'railgun', 'shard'];
    else pref = ['railgun', 'pulse', 'rocket', 'shard'];
    for (const id of pref) {
      if (this.bot.inventory.has(id) && (this.bot.ammo[id] ?? 0) >= 1) {
        this.bot.switchWeapon(id);
        return;
      }
    }
  }

  private dirTo(point: THREE.Vector3): THREE.Vector3 {
    const d = point.clone().sub(this.bot.position);
    d.y = 0;
    const len = d.length();
    return len > 1e-3 ? d.multiplyScalar(1 / len) : new THREE.Vector3();
  }

  private handleStuck(dt: number, intent: BotIntent) {
    if (intent.wishDir.lengthSq() < 0.01) { this.stuckTimer = 0; return; }
    if (this.bot.position.distanceTo(this.stuckPos) > 1.2) {
      this.stuckPos.copy(this.bot.position);
      this.stuckTimer = 0;
      return;
    }
    this.stuckTimer += dt;
    if (this.stuckTimer > 0.8) {
      intent.jump = true;
      this.repathAt = 0; // force a new path next roam tick
      this.stuckTimer = 0;
      this.stuckPos.copy(this.bot.position);
    }
  }
}

/** Shortest signed angular delta from `from` to `to` (radians). */
function shortAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
