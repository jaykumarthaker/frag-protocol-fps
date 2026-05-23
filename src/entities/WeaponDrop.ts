import * as THREE from 'three';
import { createWeaponMesh, disposeWeaponMesh, type WeaponMesh } from '../weapons/WeaponModels';
import { WEAPONS } from '../weapons/Weapons';
import type { Game } from '../core/Game';
import type { Actor } from './Actor';

/**
 * A weapon left behind by a dead actor — picked up to grant the weapon
 * plus a slug of ammo. Fades out and removes itself after `LIFETIME`
 * seconds so the floor doesn't accumulate clutter over a long match.
 *
 * Offline-only for now; online matches use the shop in Cash Raid and
 * everyone shares a loadout in deathmatch, so a server-authoritative
 * drop system would be a bigger change.
 */
const LIFETIME = 30;
const COLLECT_RADIUS = 1.8;
const FADE_START = 5; // start blinking with this many seconds left

export class WeaponDrop {
  weaponId: string;
  pos: THREE.Vector3;
  group = new THREE.Group();
  dead = false;

  private game: Game;
  private mesh: WeaponMesh;
  private halo: THREE.Mesh;
  private bornAt: number;
  private clock = 0;

  constructor(game: Game, weaponId: string, pos: THREE.Vector3) {
    this.game = game;
    this.weaponId = weaponId;
    this.pos = pos.clone();
    this.bornAt = game.time;

    const color = WEAPONS[weaponId]?.color ?? 0xb98bff;
    this.mesh = createWeaponMesh(weaponId);
    // Tilt so it doesn't lie flat — reads as "dropped" rather than placed.
    this.mesh.rotation.z = Math.PI * 0.18;
    this.group.add(this.mesh);

    this.halo = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.85, 24),
      new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.55,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.position.y = -0.45;
    this.group.add(this.halo);

    // Hover a little above the floor for visibility.
    this.group.position.copy(pos).y += 0.6;
    game.scene.add(this.group);
  }

  update(dt: number) {
    if (this.dead) return;
    this.clock += dt;
    const age = this.game.time - this.bornAt;
    const remaining = LIFETIME - age;

    // Bob + spin
    this.mesh.rotation.y = this.clock * 1.4;
    this.group.position.y = this.pos.y + 0.6 + Math.sin(this.clock * 2.4) * 0.08;

    // Blink in the last few seconds
    if (remaining < FADE_START) {
      const blink = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(this.clock * 14));
      this.group.visible = blink > 0.6 || remaining > 1.5;
    }
    if (remaining <= 0) { this.expire(); return; }

    this.tryCollect();
  }

  private tryCollect() {
    for (const a of this.game.actors) {
      if (!a.alive) continue;
      if (a.position.distanceTo(this.pos) > COLLECT_RADIUS) continue;
      if (!this.benefits(a)) continue;
      this.apply(a);
      this.game.audio.play('pickup', this.pos);
      if (a === this.game.player) {
        const label = WEAPONS[this.weaponId]?.name ?? this.weaponId.toUpperCase();
        this.game.hud.notifyPickup(label);
      }
      this.expire();
      return;
    }
  }

  /** Skip the pickup if the actor already has this weapon and full ammo. */
  private benefits(a: Actor): boolean {
    const def = WEAPONS[this.weaponId];
    if (!def) return false;
    if (!a.inventory.has(this.weaponId)) return true;
    return (a.ammo[this.weaponId] ?? 0) < def.maxAmmo;
  }

  private apply(a: Actor) {
    const def = WEAPONS[this.weaponId];
    if (!def) return;
    const isNew = !a.inventory.has(this.weaponId);
    a.inventory.add(this.weaponId);
    a.loadout.add(this.weaponId);
    a.giveAmmo(this.weaponId, isNew ? def.startAmmo : def.pickupAmmo);
    if (isNew && a === this.game.player) {
      a.switchWeapon(this.weaponId);
    }
  }

  private expire() {
    this.dead = true;
    this.dispose();
  }

  dispose() {
    this.game.scene.remove(this.group);
    disposeWeaponMesh(this.mesh);
    this.halo.geometry.dispose();
    (this.halo.material as THREE.Material).dispose();
  }
}
