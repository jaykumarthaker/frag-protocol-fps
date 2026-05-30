/**
 * Weapon definitions — pure data, no engine dependencies.
 *
 * Four archetypes inspired by classic arena shooters (original names to keep
 * the project legally clean):
 *   1. Railgun      — instant-hit precision sniper, big headshots
 *   2. Shard Cannon — flak-style pellet spread + a heavy chunk on alt-fire
 *   3. Rocket Launcher — slow splash projectile, enables rocket-jumping
 *   4. Pulse Rifle  — rapid beam + slow plasma orb; beam-detonating an orb
 *                     triggers the signature "combo" explosion
 */

export type FireKind = 'hitscan' | 'pellets' | 'projectile';
export type ProjectileKind = 'rocket' | 'orb' | 'shard';

export interface FireSpec {
  kind: FireKind;
  /** Damage per hit (hitscan), per pellet (pellets), or direct hit (projectile). */
  damage: number;
  /** Seconds between shots. */
  cooldown: number;
  ammoCost: number;
  /** Cone half-angle in radians. */
  spread: number;
  pellets?: number;
  range?: number;
  headshotMul?: number;
  projectileKind?: ProjectileKind;
  projectileSpeed?: number;
  projectileLife?: number;
  splashRadius?: number;
  splashDamage?: number;
  /** Knockback impulse magnitude applied by splash. */
  knockback?: number;
  /** UT feel — all optional, unset = no change to classic behaviour. */
  /** Wall bounces a projectile survives before it detonates. */
  bounces?: number;
  /** Seconds to wind up / fully charge this fire mode. */
  chargeTime?: number;
  /** Max shots that can be queued before a forced release (triple-rocket). */
  queueMax?: number;
}

export interface WeaponDef {
  id: string;
  name: string;
  slot: number;
  startAmmo: number;
  maxAmmo: number;
  /** Ammo granted by an ammo pickup. */
  pickupAmmo: number;
  /** Theme colour for beams / projectiles / viewmodel body. */
  color: number;
  /** Secondary theme colour — accent trim, sights, projectile cores. */
  accent: number;
  /** Respawn (seconds) for this weapon's ground ammo pickup. */
  ammoRespawn: number;
  /** Optional ADS / scope settings (currently railgun only). */
  ads?: {
    /** Camera FOV while aiming (lower = more zoom). */
    fov: number;
    /** Mouse sensitivity multiplier while aiming. */
    sensMul: number;
  };
  primary: FireSpec;
  secondary?: FireSpec;
}

export const WEAPONS: Record<string, WeaponDef> = {
  railgun: {
    id: 'railgun',
    name: 'RAILGUN',
    slot: 1,
    startAmmo: 4,
    maxAmmo: 12,
    pickupAmmo: 2,
    color: 0x36e0ff,
    accent: 0xffffff,
    ammoRespawn: 40,
    ads: { fov: 32, sensMul: 0.38 },
    primary: {
      kind: 'hitscan',
      damage: 115,
      cooldown: 1.15,
      ammoCost: 1,
      spread: 0,
      range: 360,
      headshotMul: 2.5,
      chargeTime: 0.14,
    },
  },
  shard: {
    id: 'shard',
    name: 'SHARD CANNON',
    slot: 2,
    startAmmo: 30,
    maxAmmo: 70,
    pickupAmmo: 24,
    color: 0xffd23f,
    accent: 0x2dff6a,
    ammoRespawn: 15,
    primary: {
      kind: 'pellets',
      damage: 11,
      cooldown: 0.85,
      ammoCost: 1,
      spread: 0.11,
      pellets: 9,
      range: 58,
      headshotMul: 1.25,
    },
    secondary: {
      kind: 'projectile',
      damage: 65,
      cooldown: 1.0,
      ammoCost: 2,
      spread: 0.02,
      projectileKind: 'shard',
      projectileSpeed: 36,
      projectileLife: 3,
      splashRadius: 2.4,
      splashDamage: 28,
      knockback: 8,
      bounces: 0,
      chargeTime: 0.9,
    },
  },
  rocket: {
    id: 'rocket',
    name: 'ROCKET LAUNCHER',
    slot: 3,
    startAmmo: 12,
    maxAmmo: 32,
    pickupAmmo: 10,
    color: 0xff7a18,
    accent: 0xff2a4d,
    ammoRespawn: 15,
    primary: {
      kind: 'projectile',
      damage: 32,
      cooldown: 1.0,
      ammoCost: 1,
      spread: 0,
      projectileKind: 'rocket',
      projectileSpeed: 42,
      projectileLife: 6,
      // Bigger, harder blast + a proximity fuse (see Projectile) so shots that
      // graze past — e.g. around the legs — still cook off beside the target.
      splashRadius: 6.0,
      splashDamage: 110,
      knockback: 26,
      queueMax: 3,
      chargeTime: 0.2,
    },
  },
  pulse: {
    id: 'pulse',
    name: 'PULSE RIFLE',
    slot: 4,
    startAmmo: 60,
    maxAmmo: 130,
    pickupAmmo: 50,
    color: 0xb98bff,
    accent: 0xff5fb0,
    ammoRespawn: 15,
    primary: {
      kind: 'hitscan',
      damage: 9,
      cooldown: 0.12,
      ammoCost: 1,
      spread: 0.012,
      range: 260,
      headshotMul: 1.5,
    },
    secondary: {
      kind: 'projectile',
      damage: 35,
      cooldown: 0.7,
      ammoCost: 4,
      spread: 0,
      projectileKind: 'orb',
      projectileSpeed: 19,
      projectileLife: 5,
      splashRadius: 4,
      splashDamage: 50,
      knockback: 10,
    },
  },
};

/** Weapons in slot order (1..4). */
export const WEAPON_ORDER: string[] = Object.values(WEAPONS)
  .sort((a, b) => a.slot - b.slot)
  .map((w) => w.id);

/** Damage of a successful Pulse Rifle combo (beam detonating an orb). */
export const PULSE_COMBO_DAMAGE = 130;
export const PULSE_COMBO_RADIUS = 6.5;
