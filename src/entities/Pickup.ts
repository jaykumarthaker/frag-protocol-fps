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
  private icon: THREE.Object3D;
  private iconMat: THREE.Material;
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
    this.iconMat = mat;
    this.icon = buildIcon(type, mat);
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
    this.icon.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.iconMat.dispose();
  }
}

// ----- icon builders -------------------------------------------------
// All icons share the caller-provided material so the entire pickup
// renders as a single emissive colour. Each builder returns a Group
// composed of simple primitives so the silhouette reads at a glance.

function buildIcon(type: PickupType, mat: THREE.Material): THREE.Object3D {
  switch (type) {
    case 'health':      return crossIcon(0.55, 0.18, mat);
    case 'health_mega': return crossIcon(0.85, 0.28, mat, true);
    case 'armor':       return shieldIcon(mat);
    case 'ammo':        return cartridgeIcon(mat);
    case 'amp':         return new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.3, 0.12, 64, 8), mat,
    );
  }
}

/** Two crossed bars = a + sign. A third bar along Z makes it 3D so the
 *  icon reads even when viewed from above. The optional ball at the
 *  centre is reserved for mega-health. */
function crossIcon(
  size: number, thick: number, mat: THREE.Material, withBall = false,
): THREE.Group {
  const g = new THREE.Group();
  const bar = (sx: number, sy: number, sz: number) => {
    g.add(new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat));
  };
  bar(size, thick, thick);
  bar(thick, size, thick);
  bar(thick, thick, size);
  if (withBall) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(thick * 0.95, 16, 12), mat);
    g.add(c);
  }
  return g;
}

/** A short, chunky shield silhouette extruded from a pentagon. */
function shieldIcon(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.55);
  shape.lineTo(0.45, 0.3);
  shape.lineTo(0.45, -0.15);
  shape.lineTo(0, -0.5);
  shape.lineTo(-0.45, -0.15);
  shape.lineTo(-0.45, 0.3);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.2,
    bevelEnabled: true,
    bevelSize: 0.04,
    bevelThickness: 0.04,
    bevelSegments: 2,
    curveSegments: 4,
  });
  geo.translate(0, 0, -0.1);
  g.add(new THREE.Mesh(geo, mat));
  return g;
}

/** Two stubby bullet cartridges side-by-side — bullet body + cone tip. */
function cartridgeIcon(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const make = (x: number) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.4, 12), mat);
    body.position.set(x, -0.08, 0);
    g.add(body);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.22, 12), mat);
    tip.position.set(x, 0.23, 0);
    g.add(tip);
  };
  make(-0.13);
  make(0.13);
  return g;
}
