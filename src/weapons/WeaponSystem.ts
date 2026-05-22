import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Actor } from '../entities/Actor';
import { lookDir, applySpread } from '../core/look';
import { WEAPONS, type FireSpec } from './Weapons';

/**
 * Resolves weapon fire for any actor. Hitscan weapons raycast immediately;
 * projectile weapons spawn a Projectile. The Pulse Rifle's primary beam also
 * detonates friendly/enemy plasma orbs it passes through ("combo").
 *
 * UT-feel extras: the Shard Cannon's secondary accepts a 0..1 `charge` that
 * scales the burst, and the Rocket Launcher can release a queued salvo.
 */
export class WeaponSystem {
  private game: Game;
  private up = new THREE.Vector3(0, 1, 0);

  constructor(game: Game) {
    this.game = game;
  }

  /**
   * Attempt to fire `actor`'s current weapon. Returns true if a shot left.
   * `charge` (0..1) only matters for the Shard Cannon's charged secondary.
   */
  fire(actor: Actor, alt: boolean, charge = 0): boolean {
    if (!actor.canFire()) return false;
    const weapon = WEAPONS[actor.currentWeapon];
    const spec = alt ? weapon.secondary : weapon.primary;
    if (!spec) return false;
    if ((actor.ammo[weapon.id] ?? 0) < spec.ammoCost) return false;

    actor.ammo[weapon.id] -= spec.ammoCost;
    actor.weaponReadyAt = this.game.time + spec.cooldown;

    const origin = actor.eyePosition();
    const aim = lookDir(actor.yaw, actor.pitch);

    switch (spec.kind) {
      case 'hitscan':   this.fireHitscan(actor, weapon.id, spec, origin, aim, weapon.color); break;
      case 'pellets':   this.firePellets(actor, weapon.id, spec, origin, aim, weapon.color); break;
      case 'projectile': this.fireProjectile(actor, weapon.id, spec, origin, aim, weapon.color, charge); break;
    }

    this.game.audio.play(this.sfxFor(weapon.id, alt), origin);
    this.muzzleFx(weapon.id, origin, aim, weapon.color);
    if (actor === this.game.player) this.game.shake(this.shakeFor(weapon.id, alt) + charge * 0.22);

    // in online play, broadcast the shot so other clients see it
    if (this.game.mode === 'online' && actor === this.game.player) {
      this.game.net?.send({
        t: 'fire', weapon: weapon.id, alt,
        ox: origin.x, oy: origin.y, oz: origin.z,
        dx: aim.x, dy: aim.y, dz: aim.z,
      });
    }
    return true;
  }

  /**
   * Release a queued Rocket Launcher salvo: `count` rockets in a tight fan.
   * Used by the local player's triple-rocket queue (bots fire single rockets
   * through `fire`).
   */
  fireRocketSalvo(actor: Actor, count: number): boolean {
    const weapon = WEAPONS.rocket;
    const spec = weapon.primary;
    const have = actor.ammo.rocket ?? 0;
    const n = Math.min(count, have, spec.queueMax ?? 3);
    if (n <= 0) return false;

    actor.ammo.rocket = have - n;
    actor.weaponReadyAt = this.game.time + spec.cooldown;
    const origin = actor.eyePosition();
    const aim = lookDir(actor.yaw, actor.pitch);

    for (let i = 0; i < n; i++) {
      const ang = n === 1 ? 0 : (i - (n - 1) / 2) * 0.075;
      const dir = aim.clone().applyAxisAngle(this.up, ang).normalize();
      this.game.spawnProjectile({
        owner: actor, kind: 'rocket', weaponId: 'rocket',
        origin: origin.clone().addScaledVector(dir, 0.8), dir,
        speed: spec.projectileSpeed ?? 42, life: spec.projectileLife ?? 6,
        directDamage: spec.damage, splashRadius: spec.splashRadius ?? 5.5,
        splashDamage: spec.splashDamage ?? 95, knockback: spec.knockback ?? 26,
        color: weapon.color,
      });
      if (this.game.mode === 'online' && actor === this.game.player) {
        this.game.net?.send({
          t: 'fire', weapon: 'rocket', alt: false,
          ox: origin.x, oy: origin.y, oz: origin.z,
          dx: dir.x, dy: dir.y, dz: dir.z,
        });
      }
    }

    this.game.audio.play('rocket', origin);
    this.muzzleFx('rocket', origin, aim, weapon.color);
    if (actor === this.game.player) this.game.shake(0.4 + n * 0.09);
    return true;
  }

  private fireHitscan(
    actor: Actor, weaponId: string, spec: FireSpec,
    origin: THREE.Vector3, aim: THREE.Vector3, color: number,
  ) {
    const dir = applySpread(aim, spec.spread);
    const range = spec.range ?? 250;

    // Pulse Rifle combo: a beam that crosses a plasma orb detonates it.
    if (weaponId === 'pulse') {
      const orb = this.firstOrbAlong(origin, dir, range);
      if (orb) {
        this.game.effects.beam(origin, orb.pos, color, 0.05, 0.12);
        orb.explodeCombo(actor);
        return;
      }
    }

    const hit = this.game.hitscan(origin, dir, range, actor);
    if (weaponId === 'railgun') {
      // a thick core slug + a wide, fading energy afterimage
      this.game.effects.beam(origin, hit.point, color, 0.1, 0.2);
      this.game.effects.beam(origin, hit.point, color, 0.24, 0.34);
    } else {
      this.game.effects.beam(origin, hit.point, color, 0.045);
    }
    if (hit.actor) {
      this.game.applyDamage(hit.actor, {
        amount: spec.damage * (hit.headshot ? spec.headshotMul ?? 1 : 1),
        attacker: actor,
        weaponId,
        headshot: hit.headshot,
        point: hit.point.clone(),
        knockback: dir.clone().multiplyScalar(2),
        splash: false,
      });
    } else {
      this.game.effects.impact(hit.point, hit.normal, color);
    }
  }

  private firePellets(
    actor: Actor, weaponId: string, spec: FireSpec,
    origin: THREE.Vector3, aim: THREE.Vector3, color: number,
  ) {
    const range = spec.range ?? 60;
    const count = spec.pellets ?? 1;
    for (let i = 0; i < count; i++) {
      const dir = applySpread(aim, spec.spread);
      const hit = this.game.hitscan(origin, dir, range, actor);
      this.game.effects.tracer(origin, hit.point, color);
      if (hit.actor) {
        this.game.applyDamage(hit.actor, {
          amount: spec.damage * (hit.headshot ? spec.headshotMul ?? 1 : 1),
          attacker: actor,
          weaponId,
          headshot: hit.headshot,
          point: hit.point.clone(),
          knockback: dir.clone().multiplyScalar(1.2),
          splash: false,
        });
      } else if (i % 3 === 0) {
        this.game.effects.impact(hit.point, hit.normal, color);
      }
    }
  }

  private fireProjectile(
    actor: Actor, weaponId: string, spec: FireSpec,
    origin: THREE.Vector3, aim: THREE.Vector3, color: number, charge: number,
  ) {
    const dir = applySpread(aim, spec.spread);
    // Charged Shard Burst: a held secondary scales the shard's size + blast.
    const charged = weaponId === 'shard' && charge > 0;
    this.game.spawnProjectile({
      owner: actor,
      kind: spec.projectileKind ?? 'rocket',
      weaponId,
      origin: origin.clone().addScaledVector(dir, 0.8),
      dir,
      speed: spec.projectileSpeed ?? 40,
      life: spec.projectileLife ?? 5,
      directDamage: spec.damage * (charged ? 1 + charge * 0.7 : 1),
      splashRadius: (spec.splashRadius ?? 3) * (charged ? 1 + charge : 1),
      splashDamage: (spec.splashDamage ?? spec.damage) * (charged ? 1 + charge * 1.2 : 1),
      knockback: spec.knockback ?? 8,
      color,
      bounces: spec.bounces ?? 0,
      radiusScale: charged ? 1 + charge * 0.8 : 1,
    });
  }

  /** Bigger, weapon-tinted muzzle flash at the barrel; rings for the big guns. */
  private muzzleFx(weaponId: string, origin: THREE.Vector3, aim: THREE.Vector3, color: number) {
    const pos = origin.clone().addScaledVector(aim, 0.6);
    const size = weaponId === 'railgun' ? 1.0
      : weaponId === 'rocket' ? 0.95
      : weaponId === 'shard' ? 0.8 : 0.42;
    const life = weaponId === 'pulse' ? 0.045 : 0.08;
    this.game.effects.flash(pos, color, size, life);
    if (weaponId === 'railgun' || weaponId === 'rocket') {
      this.game.effects.muzzleRing(pos, aim, color);
    }
  }

  /** Camera-shake trauma a weapon adds to the firing player. */
  private shakeFor(weaponId: string, alt: boolean): number {
    if (weaponId === 'railgun') return 0.5;
    if (weaponId === 'rocket') return 0.42;
    if (weaponId === 'shard') return alt ? 0.34 : 0.3;
    return 0.07; // pulse — a light buzz
  }

  /** Nearest plasma orb intersected by a beam from `origin` along `dir`. */
  private firstOrbAlong(origin: THREE.Vector3, dir: THREE.Vector3, range: number) {
    let best: import('../entities/Projectile').Projectile | null = null;
    let bestT = range;
    for (const p of this.game.projectiles) {
      if (p.dead || p.kind !== 'orb' || p.cosmetic) continue;
      const t = raySphere(origin, dir, p.pos, 0.55);
      if (t !== null && t < bestT) { bestT = t; best = p; }
    }
    return best;
  }

  private sfxFor(weaponId: string, alt: boolean): import('../audio/Audio').SfxName {
    if (weaponId === 'pulse') return alt ? 'orb' : 'pulse';
    if (weaponId === 'shard') return 'shard';
    if (weaponId === 'rocket') return 'rocket';
    return 'railgun';
  }
}

/** Ray-sphere intersection; returns nearest positive t or null. */
export function raySphere(
  origin: THREE.Vector3, dir: THREE.Vector3,
  center: THREE.Vector3, radius: number,
): number | null {
  const oc = origin.clone().sub(center);
  const b = oc.dot(dir);
  const c = oc.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t0 = -b - sq;
  if (t0 >= 0) return t0;
  const t1 = -b + sq;
  return t1 >= 0 ? t1 : null;
}
