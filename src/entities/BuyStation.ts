import * as THREE from 'three';
import type { Team } from '../core/types';
import type { Actor } from './Actor';
import type { BuyDef } from '../arena/CashRaidArena';

/**
 * A team's buy station: a cylindrical trigger area around a holographic
 * kiosk. Standing inside it (on your own team's station) opens the buy menu.
 */
export class BuyStation {
  team: Team;
  center: THREE.Vector3;
  radius: number;

  private group = new THREE.Group();
  private holo: THREE.Mesh;
  private spin = 0;

  constructor(scene: THREE.Scene, def: BuyDef, color: number) {
    this.team = def.team;
    this.center = def.center.clone();
    this.radius = def.radius;

    // a glowing cube hologram hovering over the podium
    this.holo = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.7, 0),
      new THREE.MeshStandardMaterial({
        color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 2.2,
        transparent: true, opacity: 0.9,
      }),
    );
    this.holo.position.set(this.center.x, 2.0, this.center.z);
    this.group.add(this.holo);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius * 0.85, 0.08, 8, 32),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 }),
    );
    ring.position.set(this.center.x, 0.6, this.center.z);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    const light = new THREE.PointLight(0xffd23f, 5, 11);
    light.position.set(this.center.x, 2.2, this.center.z);
    this.group.add(light);

    scene.add(this.group);
  }

  /** True when the actor stands within the station radius. */
  containsActor(a: Actor): boolean {
    const dx = a.position.x - this.center.x;
    const dz = a.position.z - this.center.z;
    return dx * dx + dz * dz < this.radius * this.radius;
  }

  update(dt: number) {
    this.spin += dt;
    this.holo.rotation.y = this.spin * 1.3;
    this.holo.rotation.x = this.spin * 0.7;
    this.holo.position.y = 2.0 + Math.sin(this.spin * 1.8) * 0.2;
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
