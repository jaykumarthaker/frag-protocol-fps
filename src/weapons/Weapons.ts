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
}

export interface WeaponDef {
  id: string;
  name: string;
  slot: number;
  startAmmo: number;
  maxAmmo: number;
  /** Ammo granted by an ammo pickup. */
  pickupAmmo: number;
  /** Theme colour for beams / projectiles / viewmodel. */
  color: number;
  primary: FireSpec;
  secondary?: FireSpec;
}

export const WEAPONS: Record<string, WeaponDef> = {
  railgun: {
    id: 'railgun',
    name: 'RAILGUN',
    slot: 1,
    startAmmo: 15,
    maxAmmo: 35,
    pickupAmmo: 12,
    color: 0x36e0ff,
    primary: {
      kind: 'hitscan',
      damage: 80,
      cooldown: 1.15,
      ammoCost: 1,
      spread: 0,
      range: 320,
      headshotMul: 2.0,
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
    primary: {
      kind: 'projectile',
      damage: 32,
      cooldown: 1.0,
      ammoCost: 1,
      spread: 0,
      projectileKind: 'rocket',
      projectileSpeed: 42,
      projectileLife: 6,
      splashRadius: 5.5,
      splashDamage: 95,
      knockback: 26,
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
