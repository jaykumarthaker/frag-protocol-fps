import * as THREE from 'three';
import type { Team } from '../core/types';
import { ACTOR_FEET_OFFSET, type Actor } from './Actor';
import type { VaultDef } from '../arena/CashRaidArena';

/**
 * A team's vault: an axis-aligned trigger box. Standing in it lets you deposit
 * your own carried money or steal from the enemy team's vault (the same pad
 * serves both — your vault to deposit, theirs to raid).
 */
export class VaultZone {
  team: Team;
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;

  private group = new THREE.Group();
  private pad: THREE.Mesh;
  private beacon: THREE.Mesh;
  private spin = 0;

  constructor(scene: THREE.Scene, def: VaultDef, color: number) {
    this.team = def.team;
    this.center = def.center.clone();
    this.halfExtents = def.halfExtents.clone();

    const he = this.halfExtents;
    // floor pad — fills most of the bunker interior so the deposit zone reads
    this.pad = new THREE.Mesh(
      new THREE.CylinderGeometry(he.x * 0.85, he.x * 0.95, 0.22, 32),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.4, roughness: 0.4,
      }),
    );
    this.pad.position.set(this.center.x, 0.12, this.center.z);
    this.group.add(this.pad);

    // a slow-spinning holographic beacon column
    this.beacon = new THREE.Mesh(
      new THREE.TorusGeometry(he.x * 0.45, 0.18, 8, 28),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.0,
        transparent: true, opacity: 0.85,
      }),
    );
    this.beacon.position.set(this.center.x, 2.4, this.center.z);
    this.beacon.rotation.x = Math.PI / 2;
    this.group.add(this.beacon);

    // tall holo-column that rises through the bunker so the vault is visible
    // from across the map even when the player is behind cover.
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 5.5, 16, 1, true),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 2.4,
        transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      }),
    );
    column.position.set(this.center.x, 2.95, this.center.z);
    this.group.add(column);

    const light = new THREE.PointLight(color, 8, 18);
    light.position.set(this.center.x, 3.5, this.center.z);
    this.group.add(light);

    scene.add(this.group);
  }

  /** True when the actor's feet are inside the trigger box. */
  containsActor(a: Actor): boolean {
    const he = this.halfExtents;
    const feetY = a.position.y - ACTOR_FEET_OFFSET;
    return (
      Math.abs(a.position.x - this.center.x) < he.x &&
      Math.abs(a.position.z - this.center.z) < he.z &&
      feetY < this.center.y + he.y && feetY > this.center.y - 1.0
    );
  }

  update(dt: number) {
    this.spin += dt;
    this.beacon.rotation.z = this.spin * 0.9;
    this.beacon.position.y = 2.4 + Math.sin(this.spin * 1.6) * 0.25;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
  }
}
