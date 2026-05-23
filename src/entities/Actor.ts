import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Game } from '../core/Game';
import type { DamageInfo, Team } from '../core/types';
import { WEAPONS, WEAPON_ORDER } from '../weapons/Weapons';

// --- movement tuning (arena-shooter feel: fast, floaty, twitchy) ---
const GRAVITY = 55;
const MAX_FALL = 62;
const MAX_SPEED = 11;
const GROUND_ACCEL = 10;
const AIR_ACCEL = 2.6;
const FRICTION = 8;
const JUMP_SPEED = 15.5;
const DOUBLEJUMP_SPEED = 14;
const DODGE_SPEED = 17;
const DODGE_UP = 6.5;
const DODGE_DURATION = 0.28;
const DODGE_COOLDOWN = 0.35;

export const ACTOR_RADIUS = 0.4;
export const ACTOR_HALF_HEIGHT = 0.5; // capsule cylinder half-height
/** Distance from capsule centre down to the feet. */
export const ACTOR_FEET_OFFSET = ACTOR_RADIUS + ACTOR_HALF_HEIGHT;
/** Distance from capsule centre up to the eye / camera. */
export const ACTOR_EYE_OFFSET = 0.62;

export interface HitSphere {
  center: THREE.Vector3;
  radius: number;
  head: boolean;
}

/**
 * Base class for the player and bots: a kinematic capsule with arena-style
 * movement (run / double-jump / dodge / jump-pads), health + armour, and a
 * weapon inventory. `Player` and `Bot` subclass it to supply intent.
 */
export class Actor {
  game: Game;
  name: string;
  isBot = false;
  colorHex: number;
  /** Which character model this actor wears. */
  characterId: string = 'robot';

  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Group;

  position = new THREE.Vector3(); // capsule centre
  velocity = new THREE.Vector3();
  yaw = 0;
  pitch = 0;

  grounded = false;
  private jumpsUsed = 0;
  private dodgeTimer = 0;
  private dodgeCdUntil = 0;

  health = 100;
  maxHealth = 100;
  armor = 0;
  maxArmor = 150;
  alive = true;
  invulnUntil = 0;
  ampUntil = 0;
  deathTime = 0;

  inventory = new Set<string>();
  ammo: Record<string, number> = {};
  currentWeapon = 'shard';
  weaponReadyAt = 0;
  /**
   * Weapons granted on (re)spawn. Empty = every weapon (deathmatch default).
   * In Cash Raid this starts as just the basic weapon and grows with
   * purchases, so bought guns survive death.
   */
  loadout = new Set<string>();

  // scoring / kill-streak bookkeeping
  frags = 0;
  deaths = 0;
  lastKillTime = -99;
  multiKill = 0;
  spree = 0;
  lastDamagedAt = -99;

  // --- Cash Raid (team / economy) — inert in deathmatch ---
  /** 0 = no team (deathmatch); 1 / 2 are the Cash Raid teams. */
  team: Team = 0;
  /** Money currently carried; dropped (partially) on death. */
  carried = 0;
  /** Career stats for the Cash Raid scoreboard. */
  moneyBanked = 0;
  moneyStolen = 0;
  /** game.time the in-vault deposit channel began (0 = not channelling). */
  depositChannelStart = 0;

  private tmp = new THREE.Vector3();

  constructor(game: Game, name: string, colorHex: number, spawnFeet: THREE.Vector3) {
    this.game = game;
    this.name = name;
    this.colorHex = colorHex;

    const center = spawnFeet.clone();
    center.y += ACTOR_FEET_OFFSET;
    this.position.copy(center);

    const { body, collider } = game.physics.addActorCapsule(center, ACTOR_HALF_HEIGHT, ACTOR_RADIUS);
    this.body = body;
    this.collider = collider;

    // The visual mesh is a container; subclasses populate it (Bot adds the
    // animated robot model, Player stays empty — first person).
    this.mesh = new THREE.Group();
  }

  // ---- visual ---------------------------------------------------------

  /** Sync the visual mesh to physics state, then run subclass animation. */
  syncMesh(dt: number) {
    this.mesh.position.set(
      this.position.x,
      this.position.y - ACTOR_FEET_OFFSET,
      this.position.z,
    );
    this.mesh.rotation.y = this.yaw + Math.PI;
    this.updateVisual(dt);
  }

  /** Per-frame animation update — overridden by Bot. */
  protected updateVisual(_dt: number) {}

  // ---- spawning -------------------------------------------------------

  respawn(feet: THREE.Vector3) {
    const c = feet.clone();
    c.y += ACTOR_FEET_OFFSET;
    this.position.copy(c);
    this.body.setTranslation({ x: c.x, y: c.y, z: c.z }, true);
    this.velocity.set(0, 0, 0);
    this.health = this.maxHealth;
    this.armor = 0;
    this.alive = true;
    this.collider.setEnabled(true);
    this.grounded = false;
    this.jumpsUsed = 0;
    this.dodgeTimer = 0;
    this.ampUntil = 0;
    this.invulnUntil = this.game.time + 2;
    this.carried = 0;
    this.depositChannelStart = 0;

    this.inventory.clear();
    const granted = this.loadout.size > 0 ? this.loadout : WEAPON_ORDER;
    for (const id of granted) {
      this.inventory.add(id);
      this.ammo[id] = WEAPONS[id].startAmmo;
    }
    // keep 'shard' as the default when owned (deathmatch), else first owned
    this.currentWeapon = this.inventory.has('shard')
      ? 'shard'
      : WEAPON_ORDER.find((id) => this.inventory.has(id)) ?? 'shard';
    this.weaponReadyAt = this.game.time + 0.3;
  }

  // ---- queries --------------------------------------------------------

  eyePosition(): THREE.Vector3 {
    return new THREE.Vector3(this.position.x, this.position.y + ACTOR_EYE_OFFSET, this.position.z);
  }

  /** Spheres used for hitscan / projectile hit detection. */
  hitSpheres(): HitSphere[] {
    const p = this.position;
    return [
      { center: new THREE.Vector3(p.x, p.y + 0.6, p.z), radius: 0.34, head: true },
      { center: new THREE.Vector3(p.x, p.y + 0.05, p.z), radius: 0.5, head: false },
      { center: new THREE.Vector3(p.x, p.y - 0.58, p.z), radius: 0.44, head: false },
    ];
  }

  ampActive(): boolean { return this.ampUntil > this.game.time; }
  protectedNow(): boolean { return this.game.time < this.invulnUntil; }

  // ---- combat ---------------------------------------------------------

  takeDamage(info: DamageInfo): { dealt: number; died: boolean } {
    if (!this.alive || this.protectedNow()) return { dealt: 0, died: false };

    let amount = info.amount;
    if (info.attacker && info.attacker !== this && info.attacker.ampActive()) {
      amount *= 2;
    }
    if (this.armor > 0) {
      const absorbed = Math.min(this.armor, amount * 0.66);
      this.armor -= absorbed;
      amount -= absorbed;
    }
    this.health -= amount;
    this.lastDamagedAt = this.game.time;
    if (info.knockback) this.velocity.add(info.knockback);

    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.deathTime = this.game.time;
      this.deaths++;
      // a corpse should not block movement or stop bullets
      this.collider.setEnabled(false);
      return { dealt: amount, died: true };
    }
    return { dealt: amount, died: false };
  }

  // ---- weapons --------------------------------------------------------

  canFire(): boolean { return this.alive && this.game.time >= this.weaponReadyAt; }

  switchWeapon(id: string) {
    if (!this.inventory.has(id) || id === this.currentWeapon) return;
    this.currentWeapon = id;
    this.weaponReadyAt = Math.max(this.weaponReadyAt, this.game.time + 0.22);
  }

  cycleWeapon(dir: number) {
    const i = WEAPON_ORDER.indexOf(this.currentWeapon);
    const n = WEAPON_ORDER.length;
    this.switchWeapon(WEAPON_ORDER[(i + dir + n * 2) % n]);
  }

  giveAmmo(id: string, n: number) {
    this.ammo[id] = Math.min(WEAPONS[id].maxAmmo, (this.ammo[id] ?? 0) + n);
  }
  giveAmmoAll() {
    for (const id of WEAPON_ORDER) this.giveAmmo(id, WEAPONS[id].pickupAmmo);
  }

  // ---- movement -------------------------------------------------------

  /**
   * Integrate one movement step.
   * @param wishDir world-space horizontal desired direction (length 0..1)
   * @param wantJump jump pressed this frame
   * @param dodgeDir world-space dodge direction, or null
   */
  move(dt: number, wishDir: THREE.Vector3, wantJump: boolean, dodgeDir: THREE.Vector3 | null) {
    const t = this.game.time;

    // dodge trigger
    if (dodgeDir && dodgeDir.lengthSq() > 1e-4 && t >= this.dodgeCdUntil) {
      const d = this.tmp.copy(dodgeDir).setY(0).normalize();
      this.velocity.x = d.x * DODGE_SPEED;
      this.velocity.z = d.z * DODGE_SPEED;
      this.velocity.y = DODGE_UP;
      this.dodgeTimer = DODGE_DURATION;
      this.dodgeCdUntil = t + DODGE_COOLDOWN;
      this.grounded = false;
      this.game.audio.play('dodge', this.position);
    }
    if (this.dodgeTimer > 0) this.dodgeTimer -= dt;

    // quake-style horizontal acceleration
    const wish = this.tmp.set(wishDir.x, 0, wishDir.z);
    let wishLen = wish.length();
    if (wishLen > 1) wishLen = 1;
    if (wishLen > 1e-4) wish.normalize();
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;
    const curDot = this.velocity.x * wish.x + this.velocity.z * wish.z;
    const addSpeed = MAX_SPEED * wishLen - curDot;
    if (addSpeed > 0) {
      let accelSpeed = accel * dt * MAX_SPEED;
      if (accelSpeed > addSpeed) accelSpeed = addSpeed;
      this.velocity.x += accelSpeed * wish.x;
      this.velocity.z += accelSpeed * wish.z;
    }

    // ground friction (suspended during a dodge so it carries)
    if (this.grounded && this.dodgeTimer <= 0) {
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      if (speed > 0.01) {
        const scale = Math.max(0, speed - speed * FRICTION * dt) / speed;
        this.velocity.x *= scale;
        this.velocity.z *= scale;
      }
    }

    // jump / double-jump
    if (wantJump) {
      if (this.grounded) {
        this.velocity.y = JUMP_SPEED;
        this.jumpsUsed = 1;
        this.grounded = false;
        this.game.audio.play('jump', this.position);
      } else if (this.jumpsUsed < 2) {
        this.velocity.y = DOUBLEJUMP_SPEED;
        this.jumpsUsed = 2;
        this.game.audio.play('jump', this.position);
      }
    }

    // gravity
    this.velocity.y -= GRAVITY * dt;
    if (this.velocity.y < -MAX_FALL) this.velocity.y = -MAX_FALL;

    // resolve movement against world + other actors
    const ctrl = this.game.physics.controller;
    const desired = { x: this.velocity.x * dt, y: this.velocity.y * dt, z: this.velocity.z * dt };
    ctrl.computeColliderMovement(this.collider, desired);
    const mv = ctrl.computedMovement();
    this.grounded = ctrl.computedGrounded();

    // reconcile velocity with what actually happened (walls / ceilings)
    if (dt > 1e-5) {
      if (Math.abs(mv.x) + 1e-3 < Math.abs(desired.x)) this.velocity.x = mv.x / dt;
      if (Math.abs(mv.z) + 1e-3 < Math.abs(desired.z)) this.velocity.z = mv.z / dt;
      if (this.velocity.y > 0 && mv.y + 1e-3 < desired.y) this.velocity.y = 0;
    }

    this.position.x += mv.x;
    this.position.y += mv.y;
    this.position.z += mv.z;

    if (this.grounded) {
      this.jumpsUsed = 0;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }

    // jump pads
    for (const pad of this.game.arena.jumpPads) {
      const he = pad.halfExtents;
      const feetY = this.position.y - ACTOR_FEET_OFFSET;
      if (
        this.velocity.y < 3 &&
        Math.abs(this.position.x - pad.pos.x) < he.x &&
        Math.abs(this.position.z - pad.pos.z) < he.z &&
        feetY < pad.pos.y + he.y && feetY > pad.pos.y - he.y - 0.6
      ) {
        this.velocity.copy(pad.launch);
        this.grounded = false;
        this.jumpsUsed = 1;
        this.game.audio.play('jumppad', pad.pos);
        break;
      }
    }

    // fell out of the world — snap back via respawn handling
    if (this.position.y < -25) {
      const res = this.takeDamage({
        amount: 1000, attacker: null, weaponId: 'void',
        headshot: false, point: this.position.clone(), knockback: null, splash: false,
      });
      if (res.died) this.game.onActorDied(this, null, 'void', false);
    }

    this.body.setNextKinematicTranslation({ x: this.position.x, y: this.position.y, z: this.position.z });
  }
}
