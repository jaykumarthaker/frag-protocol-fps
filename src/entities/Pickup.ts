import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Actor } from './Actor';

export type PickupType = 'health' | 'health_mega' | 'armor' | 'ammo' | 'amp';

interface PickupSpec {
  respawn: number;
  color: number;
  glow: boolean;
  label: string;
}

const SPECS: Record<PickupType, PickupSpec> = {
  health:      { respawn: 20, color: 0x6dff8a, glow: false, label: '+25 HEALTH' },
  health_mega: { respawn: 35, color: 0x2dff6a, glow: true,  label: 'MEGA HEALTH' },
  armor:       { respawn: 25, color: 0x36e0ff, glow: false, label: '+75 ARMOR' },
  ammo:        { respawn: 15, color: 0xff7a18, glow: false, label: 'AMMO' },
  amp:         { respawn: 30, color: 0xb98bff, glow: true,  label: 'DAMAGE AMP' },
};

/** A floating, respawning arena pickup (health / armour / ammo / power-up). */
export class Pickup {
  type: PickupType;
  pos: THREE.Vector3;
  group = new THREE.Group();
  private game: Game;
  private spec: PickupSpec;
  private active = true;
  private respawnAt = 0;
  private spin = Math.random() * Math.PI * 2;
  private icon: THREE.Mesh;
  private light?: THREE.PointLight;

  constructor(game: Game, type: PickupType, pos: THREE.Vector3) {
    this.game = game;
    this.type = type;
    this.pos = pos.clone();
    this.spec = SPECS[type];
    this.group.position.copy(this.pos);

    const mat = new THREE.MeshStandardMaterial({
      color: this.spec.color,
      emissive: this.spec.color,
      emissiveIntensity: 0.9,
      roughness: 0.35,
      metalness: 0.4,
    });
    this.icon = new THREE.Mesh(this.iconGeometry(type), mat);
    this.group.add(this.icon);

    // ground halo
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.7, 24),
      new THREE.MeshBasicMaterial({
        color: this.spec.color, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = -1.1;
    this.group.add(halo);

    if (this.spec.glow) {
      this.light = new THREE.PointLight(this.spec.color, 5, 9);
      this.group.add(this.light);
    }
    game.scene.add(this.group);
  }

  private iconGeometry(type: PickupType): THREE.BufferGeometry {
    switch (type) {
      case 'health':      return new THREE.OctahedronGeometry(0.4);
      case 'health_mega': return new THREE.OctahedronGeometry(0.6);
      case 'armor':       return new THREE.IcosahedronGeometry(0.45);
      case 'ammo':        return new THREE.BoxGeometry(0.6, 0.5, 0.6);
      case 'amp':         return new THREE.TorusKnotGeometry(0.3, 0.12, 64, 8);
    }
  }

  update(dt: number) {
    if (this.active) {
      this.spin += dt * 1.6;
      this.icon.rotation.y = this.spin;
      this.icon.rotation.x = this.spin * 0.5;
      this.icon.position.y = Math.sin(this.spin * 1.3) * 0.12;
      this.tryCollect();
    } else if (this.game.time >= this.respawnAt) {
      this.setActive(true);
      this.game.effects.flash(this.pos, this.spec.color, 1.4, 0.25);
    }
  }

  private setActive(on: boolean) {
    this.active = on;
    this.icon.visible = on;
    if (this.light) this.light.visible = on;
    this.group.children.forEach((c) => { if (c !== this.icon && c !== this.light) c.visible = on; });
  }

  private tryCollect() {
    for (const a of this.game.actors) {
      if (!a.alive) continue;
      if (a.position.distanceTo(this.pos) > 1.7) continue;
      if (!this.benefits(a)) continue;
      this.apply(a);
      this.setActive(false);
      this.respawnAt = this.game.time + this.spec.respawn;
      const big = this.type === 'amp' || this.type === 'health_mega';
      this.game.audio.play(big ? 'pickupbig' : 'pickup', this.pos);
      if (a === this.game.player) this.game.hud.notifyPickup(this.spec.label);
      return;
    }
  }

  /** Whether the pickup would actually help this actor (avoid wasting it). */
  private benefits(a: Actor): boolean {
    switch (this.type) {
      case 'health':      return a.health < a.maxHealth;
      case 'health_mega': return a.health < 150;
      case 'armor':       return a.armor < a.maxArmor;
      case 'ammo':        return true;
      case 'amp':         return !a.ampActive();
    }
  }

  private apply(a: Actor) {
    switch (this.type) {
      case 'health':      a.health = Math.min(a.maxHealth, a.health + 25); break;
      case 'health_mega': a.health = Math.min(150, a.health + 50); break;
      case 'armor':       a.armor = Math.min(a.maxArmor, a.armor + 75); break;
      case 'ammo':        a.giveAmmoAll(); break;
      case 'amp':         a.ampUntil = this.game.time + 25; break;
    }
  }

  /** True if this is a high-value pickup a bot should actively path toward. */
  get strategic(): boolean {
    return this.active && (this.type === 'amp' || this.type === 'armor' || this.type === 'health_mega');
  }

  get isActive(): boolean { return this.active; }

  /** Remove from the scene and free GPU resources (match cleanup). */
  dispose() {
    this.game.scene.remove(this.group);
    this.icon.geometry.dispose();
    (this.icon.material as THREE.Material).dispose();
  }
}
