import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Actor } from '../entities/Actor';
import { lookDir, applySpread } from '../core/look';
import { WEAPONS, type FireSpec } from './Weapons';

/**
 * Resolves weapon fire for any actor. Hitscan weapons raycast immediately;
 * projectile weapons spawn a Projectile. The Pulse Rifle's primary beam also
 * detonates friendly/enemy plasma orbs it passes through ("combo").
 */
export class WeaponSystem {
  private game: Game;

  constructor(game: Game) {
    this.game = game;
  }

  /** Attempt to fire `actor`'s current weapon. Returns true if a shot left. */
  fire(actor: Actor, alt: boolean): boolean {
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
      case 'projectile': this.fireProjectile(actor, weapon.id, spec, origin, aim, weapon.color); break;
    }

    this.game.audio.play(this.sfxFor(weapon.id, alt), origin);
    this.game.effects.flash(origin.clone().addScaledVector(aim, 0.6), weapon.color, 0.5);

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
    this.game.effects.beam(origin, hit.point, color, weaponId === 'railgun' ? 0.1 : 0.045);
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
    origin: THREE.Vector3, aim: THREE.Vector3, color: number,
  ) {
    const dir = applySpread(aim, spec.spread);
    this.game.spawnProjectile({
      owner: actor,
      kind: spec.projectileKind ?? 'rocket',
      weaponId,
      origin: origin.clone().addScaledVector(dir, 0.8),
      dir,
      speed: spec.projectileSpeed ?? 40,
      life: spec.projectileLife ?? 5,
      directDamage: spec.damage,
      splashRadius: spec.splashRadius ?? 3,
      splashDamage: spec.splashDamage ?? spec.damage,
      knockback: spec.knockback ?? 8,
      color,
    });
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
