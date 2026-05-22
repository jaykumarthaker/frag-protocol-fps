import * as THREE from 'three';
import type { Game } from '../core/Game';
import { ACTOR_FEET_OFFSET, type Actor } from './Actor';

/** Seconds a dropped cash briefcase stays on the ground before vanishing. */
export const CASH_DROP_LIFETIME = 30;
const COLLECT_RADIUS = 1.9;

/**
 * A briefcase of money on the ground — spawned when a carrier dies (70% of
 * what they held). One-shot: any living actor of either team can pick it up,
 * and it expires after CASH_DROP_LIFETIME seconds.
 */
export class CashDrop {
  amount: number;
  pos: THREE.Vector3;
  dead = false;
  collectedBy: Actor | null = null;
  /** Server drop id (online); 0 for offline drops. */
  id = 0;
  /** Online drops are visual-only — the server owns collection / expiry. */
  private passive: boolean;

  private game: Game;
  private mesh: THREE.Group;
  private bornAt: number;
  private spin = Math.random() * 6.28;

  constructor(
    game: Game, amount: number, feet: THREE.Vector3,
    opts?: { id?: number; passive?: boolean },
  ) {
    this.game = game;
    this.amount = amount;
    this.pos = feet.clone();
    this.bornAt = game.time;
    this.id = opts?.id ?? 0;
    this.passive = opts?.passive ?? false;

    const scale = THREE.MathUtils.clamp(0.55 + amount / 50000, 0.55, 1.15);
    this.mesh = new THREE.Group();

    const caseMat = new THREE.MeshStandardMaterial({
      color: 0x2a3140, roughness: 0.6, metalness: 0.3,
    });
    const briefcase = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 0.35), caseMat);
    briefcase.castShadow = true;
    this.mesh.add(briefcase);

    const glowMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 1.8,
    });
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.14, 0.16, 0.39), glowMat);
    this.mesh.add(band);

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.0, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd23f, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -0.34;
    this.mesh.add(halo);

    const light = new THREE.PointLight(0xffd23f, 3, 7);
    light.position.y = 0.5;
    this.mesh.add(light);

    this.mesh.scale.setScalar(scale);
    this.mesh.position.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
    game.scene.add(this.mesh);
  }

  update(dt: number) {
    if (this.dead) return;
    const age = this.game.time - this.bornAt;

    this.spin += dt * 1.8;
    this.mesh.rotation.y = this.spin;
    this.mesh.position.y = this.pos.y + 0.55 + Math.sin(this.spin * 1.4) * 0.12;
    // blink out over the last 4 seconds of life
    const left = CASH_DROP_LIFETIME - age;
    this.mesh.visible = left > 4 || Math.sin(age * 12) > -0.3;

    // online drops are visual only — the server owns collection + expiry
    if (this.passive) return;
    if (age >= CASH_DROP_LIFETIME) { this.dead = true; return; }

    for (const a of this.game.actors) {
      if (!a.alive) continue;
      const dx = a.position.x - this.pos.x;
      const dz = a.position.z - this.pos.z;
      const dy = (a.position.y - ACTOR_FEET_OFFSET) - this.pos.y;
      if (dx * dx + dz * dz + dy * dy < COLLECT_RADIUS * COLLECT_RADIUS) {
        a.carried += this.amount;
        a.moneyStolen += this.amount;
        this.collectedBy = a;
        this.dead = true;
        return;
      }
    }
  }

  dispose() {
    this.mesh.removeFromParent();
    this.mesh.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
  }
}
