import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Actor } from './Actor';
import type { ProjectileKind } from '../weapons/Weapons';
import { PULSE_COMBO_DAMAGE, PULSE_COMBO_RADIUS } from '../weapons/Weapons';

export interface ProjectileOpts {
  owner: Actor;
  kind: ProjectileKind;
  weaponId: string;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  life: number;
  directDamage: number;
  splashRadius: number;
  splashDamage: number;
  knockback: number;
  color: number;
  /** Wall bounces survived before detonating (ricochet shards). */
  bounces?: number;
  /** Visual size multiplier — charged Shard Cannon bursts fly bigger. */
  radiusScale?: number;
  /** Visual-only: flies and detonates with FX but deals no damage. Used to
   *  show other players' shots in online play (the firer owns the damage). */
  cosmetic?: boolean;
}

const RADIUS: Record<ProjectileKind, number> = { rocket: 0.22, orb: 0.32, shard: 0.16 };

/**
 * A moving projectile (rocket / plasma orb / flak chunk). Integrated manually
 * each frame; collisions are resolved by raycasting world geometry and by
 * point-to-segment tests against actor bodies. Shard chunks ricochet off
 * walls; rockets spin and leave a smoke trail.
 */
export class Projectile {
  game: Game;
  owner: Actor;
  kind: ProjectileKind;
  weaponId: string;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  dead = false;
  cosmetic = false;
  private opts: ProjectileOpts;
  private mesh: THREE.Mesh;
  private light: THREE.PointLight;
  private radius: number;
  private bounces: number;
  private trailTimer = 0;

  constructor(game: Game, opts: ProjectileOpts) {
    this.game = game;
    this.opts = opts;
    this.owner = opts.owner;
    this.kind = opts.kind;
    this.weaponId = opts.weaponId;
    this.pos = opts.origin.clone();
    this.vel = opts.dir.clone().normalize().multiplyScalar(opts.speed);
    this.life = opts.life;
    this.cosmetic = !!opts.cosmetic;
    this.bounces = opts.bounces ?? 0;
    this.radius = RADIUS[opts.kind] * (opts.radiusScale ?? 1);

    const r = this.radius;
    const geo = opts.kind === 'rocket'
      ? new THREE.CapsuleGeometry(r, r * 2.4, 4, 8)
      : opts.kind === 'shard'
        ? new THREE.IcosahedronGeometry(r * 1.7, 0)
        : new THREE.SphereGeometry(r * 1.4, 12, 10);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: opts.color, emissive: opts.color, emissiveIntensity: 2.2, roughness: 0.4,
      }),
    );
    this.mesh.position.copy(this.pos);
    if (opts.kind === 'rocket') {
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.vel.clone().normalize());
    }
    game.scene.add(this.mesh);

    this.light = new THREE.PointLight(opts.color, 6, 8);
    this.light.position.copy(this.pos);
    game.scene.add(this.light);
  }

  update(dt: number) {
    if (this.dead) return;
    this.life -= dt;
    if (this.life <= 0) { this.remove(); return; }

    const prev = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    const seg = this.pos.clone().sub(prev);
    const segLen = seg.length();
    if (segLen < 1e-5) return;
    const dir = seg.clone().multiplyScalar(1 / segLen);

    // world geometry
    const worldHit = this.game.physics.raycastWorld(prev, dir, segLen);
    let hitDist = worldHit ? worldHit.toi : Infinity;
    let hitActor: Actor | null = null;

    // actors (direct hits — never the owner; cosmetic projectiles skip this)
    if (!this.opts.cosmetic) {
      for (const a of this.game.actors) {
        if (!a.alive || a === this.owner) continue;
        const d = distPointToSegment(a.position, prev, this.pos);
        if (d < 0.62 + this.radius) {
          const along = a.position.clone().sub(prev).dot(dir);
          if (along >= 0 && along < hitDist) { hitDist = along; hitActor = a; }
        }
      }
    }

    if (hitDist <= segLen) {
      this.pos.copy(prev).addScaledVector(dir, hitDist);
      if (!hitActor && worldHit && this.bounces > 0) {
        this.ricochet(worldHit.normal);
      } else {
        this.explode(hitActor);
        return;
      }
    }

    this.spin(dt);
    this.mesh.position.copy(this.pos);
    this.light.position.copy(this.pos);
  }

  /** Spin the visible mesh + (rockets) drop a fading smoke puff. */
  private spin(dt: number) {
    if (this.kind === 'rocket') {
      this.mesh.rotateOnWorldAxis(this.vel.clone().normalize(), dt * 14);
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = 0.035;
        this.game.effects.puff(this.pos, 0x6a6f7a, 0.5, 0.5);
      }
    } else if (this.kind === 'shard') {
      this.mesh.rotation.x += dt * 9;
      this.mesh.rotation.y += dt * 7;
    }
  }

  /** Bounce off a wall: reflect velocity, lose a little energy, spark. */
  private ricochet(normalLike: { x: number; y: number; z: number }) {
    this.bounces--;
    const n = new THREE.Vector3(normalLike.x, normalLike.y, normalLike.z).normalize();
    this.vel.reflect(n).multiplyScalar(0.9);
    this.pos.addScaledVector(n, this.radius + 0.04);
    this.game.effects.impact(this.pos, n, this.opts.color);
    this.game.audio.play('hit', this.pos);
  }

  /** Normal detonation (wall, direct hit, or expiry). */
  explode(directTarget: Actor | null) {
    if (this.dead) return;
    const o = this.opts;
    if (o.cosmetic) {
      this.game.effects.explosion(this.pos, o.splashRadius, o.color);
      this.game.audio.play('explosion', this.pos);
      this.feelExplosion(o.splashRadius);
      this.remove();
      return;
    }
    if (directTarget) {
      this.game.applyDamage(directTarget, {
        amount: o.directDamage,
        attacker: this.owner,
        weaponId: this.weaponId,
        headshot: false,
        point: this.pos.clone(),
        knockback: this.vel.clone().normalize().multiplyScalar(6),
        splash: false,
      });
    }
    this.game.radialDamage(
      this.pos, o.splashRadius, o.splashDamage,
      this.owner, this.weaponId, o.knockback, directTarget,
    );
    this.game.effects.explosion(this.pos, o.splashRadius, o.color);
    this.game.audio.play('explosion', this.pos);
    this.feelExplosion(o.splashRadius);
    this.remove();
  }

  /** Pulse-rifle "combo": a beam detonated this orb for big radial damage. */
  explodeCombo(beamOwner: Actor) {
    if (this.dead) return;
    this.game.radialDamage(
      this.pos, PULSE_COMBO_RADIUS, PULSE_COMBO_DAMAGE,
      beamOwner, 'pulse_combo', 22, null,
    );
    this.game.effects.explosion(this.pos, PULSE_COMBO_RADIUS, 0xb98bff);
    this.game.effects.flash(this.pos, 0xffffff, 4, 0.18);
    this.game.audio.play('combo', this.pos);
    this.feelExplosion(PULSE_COMBO_RADIUS * 1.3);
    this.remove();
  }

  /** Shake the camera if the blast went off near the local player's view. */
  private feelExplosion(radius: number) {
    const d = this.game.camera.position.distanceTo(this.pos);
    const reach = radius * 3.5;
    if (d < reach) this.game.shake((1 - d / reach) * 0.75);
  }

  /** Remove immediately without detonating (used when clearing a match). */
  dispose() {
    if (!this.dead) this.remove();
  }

  private remove() {
    this.dead = true;
    this.game.scene.remove(this.mesh);
    this.game.scene.remove(this.light);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Shortest distance from point `p` to segment `a`-`b`. */
function distPointToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const ab = b.clone().sub(a);
  const lenSq = ab.lengthSq();
  if (lenSq < 1e-9) return p.distanceTo(a);
  let t = p.clone().sub(a).dot(ab) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}
