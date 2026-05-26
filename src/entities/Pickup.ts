import * as THREE from 'three';
import type { Game } from '../core/Game';
import type { Actor } from './Actor';
import { WEAPONS } from '../weapons/Weapons';

export type PickupType =
  | 'health' | 'health_mega' | 'armor' | 'amp'
  | 'ammo_railgun' | 'ammo_shard' | 'ammo_rocket' | 'ammo_pulse';

interface PickupSpec {
  respawn: number;
  color: number;
  glow: boolean;
  label: string;
}

const SPECS: Record<PickupType, PickupSpec> = {
  health:       { respawn: 20, color: 0x6dff8a, glow: false, label: '+25 HEALTH' },
  health_mega:  { respawn: 35, color: 0x2dff6a, glow: true,  label: 'MEGA HEALTH' },
  armor:        { respawn: 25, color: 0x36e0ff, glow: false, label: '+75 ARMOR' },
  amp:          { respawn: 30, color: 0xb98bff, glow: true,  label: 'DAMAGE AMP' },
  ammo_railgun: { respawn: WEAPONS.railgun.ammoRespawn, color: WEAPONS.railgun.color, glow: true,  label: 'RAILGUN SLUG' },
  ammo_shard:   { respawn: WEAPONS.shard.ammoRespawn,   color: WEAPONS.shard.color,   glow: false, label: 'SHARD MAG' },
  ammo_rocket:  { respawn: WEAPONS.rocket.ammoRespawn,  color: WEAPONS.rocket.color,  glow: false, label: 'ROCKETS' },
  ammo_pulse:   { respawn: WEAPONS.pulse.ammoRespawn,   color: WEAPONS.pulse.color,   glow: false, label: 'PULSE CELL' },
};

/** Map an ammo PickupType to the weapon id it refills. */
function ammoWeapon(type: PickupType): string | null {
  switch (type) {
    case 'ammo_railgun': return 'railgun';
    case 'ammo_shard':   return 'shard';
    case 'ammo_rocket':  return 'rocket';
    case 'ammo_pulse':   return 'pulse';
    default: return null;
  }
}

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
      case 'amp':         return !a.ampActive();
      default: {
        const wid = ammoWeapon(this.type);
        if (!wid) return false;
        // Only collect this weapon's ammo if the actor owns the weapon and isn't capped.
        if (!a.inventory.has(wid)) return false;
        return (a.ammo[wid] ?? 0) < WEAPONS[wid].maxAmmo;
      }
    }
  }

  private apply(a: Actor) {
    switch (this.type) {
      case 'health':      a.health = Math.min(a.maxHealth, a.health + 25); break;
      case 'health_mega': a.health = Math.min(150, a.health + 50); break;
      case 'armor':       a.armor = Math.min(a.maxArmor, a.armor + 75); break;
      case 'amp':         a.ampUntil = this.game.time + 25; break;
      default: {
        const wid = ammoWeapon(this.type);
        if (wid) a.giveAmmo(wid, WEAPONS[wid].pickupAmmo);
      }
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
    case 'amp':         return new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.3, 0.12, 64, 8), mat,
    );
    case 'ammo_railgun': return railSlugIcon(mat);
    case 'ammo_shard':   return shardClusterIcon(mat);
    case 'ammo_rocket':  return rocketAmmoIcon(mat);
    case 'ammo_pulse':   return pulseCellIcon(mat);
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

/** Railgun ammo — a tall, narrow energy slug (matches the cyan accelerator). */
function railSlugIcon(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.62, 14), mat));
  g.add(new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.18, 14), mat)).position.y = 0.4;
  // ring collars so it reads as the railgun's barrel coils miniaturised
  for (const y of [-0.18, 0, 0.18]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 16), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y;
    g.add(ring);
  }
  return g;
}

/** Shard Cannon ammo — a faceted crystal cluster like the gun's magazine. */
function shardClusterIcon(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), mat));
  const a = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), mat);
  a.position.set(0.22, 0.08, 0);
  a.rotation.set(0.4, 0.3, 0.2);
  g.add(a);
  const b = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), mat);
  b.position.set(-0.2, -0.1, 0.05);
  b.rotation.set(-0.3, 0.6, -0.2);
  g.add(b);
  return g;
}

/** Rocket Launcher ammo — a single mini warhead (cone + body + fins). */
function rocketAmmoIcon(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.46, 14), mat);
  body.position.y = -0.05;
  g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.24, 14), mat);
  tip.position.y = 0.3;
  g.add(tip);
  // tail fins
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.18), mat);
    fin.position.y = -0.26;
    fin.rotation.y = (i * Math.PI) / 2;
    fin.position.x = Math.cos(fin.rotation.y) * 0.12;
    fin.position.z = Math.sin(fin.rotation.y) * 0.12;
    g.add(fin);
  }
  return g;
}

/** Pulse Rifle ammo — a glowing plasma cell (sphere in a cradle). */
function pulseCellIcon(mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), mat));
  // cradle bands
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 24), mat);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.035, 8, 24), mat);
  g.add(ring2);
  // caps
  for (const y of [-0.34, 0.34]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.08, 12), mat);
    cap.position.y = y;
    g.add(cap);
  }
  return g;
}
