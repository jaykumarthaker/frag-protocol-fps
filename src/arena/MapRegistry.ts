import type * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { GameMode } from '../core/types';
import { Arena } from './Arena';
import { AtriumArena } from './AtriumArena';
import { CashRaidArena } from './CashRaidArena';
import { VaultYardArena } from './VaultYardArena';

/**
 * Map registry. Each entry describes one playable arena and how to construct
 * it. The Game looks up the requested map by id when starting a match; new
 * maps just add an entry here.
 */
export interface MapDef {
  id: string;
  name: string;
  description: string;
  /** Modes this map supports. Maps shown in the menu are filtered by mode. */
  modes: GameMode[];
  factory: (scene: THREE.Scene, physics: Physics) => Arena;
}

export const MAPS: readonly MapDef[] = [
  {
    id: 'atrium',
    name: 'The Atrium',
    description:
      'A Citadel-style sky arena of stacked tiers: two mountain bases drop ' +
      'by wide causeways to a central ring, with a sunken valley beneath the ' +
      'spire and an amp on the crown. Step off the edge and you fall forever.',
    modes: ['deathmatch'],
    factory: (s, p) => new AtriumArena(s, p),
  },
  {
    id: 'duel',
    name: 'Foundry Duel',
    description:
      'Compact central platform with side ledges. Tight rotations and ' +
      'short sightlines — built for 1v1 and small matches.',
    modes: ['deathmatch'],
    factory: (s, p) => new Arena(s, p),
  },
  {
    id: 'cashraid',
    name: 'Vault Standoff',
    description:
      'Two opposing bases with vaults and buy stations across a contested midfield.',
    modes: ['cashraid'],
    factory: (s, p) => new CashRaidArena(s, p),
  },
  {
    id: 'vaultyard',
    name: 'Vault Yard',
    description:
      'Compact close-quarters Cash Raid map. Vaults sit against the back ' +
      'wall, mid is a low cover ring — short steal cycles, brawl pace.',
    modes: ['cashraid'],
    factory: (s, p) => new VaultYardArena(s, p),
  },
];

export const DEFAULT_MAP: Record<GameMode, string> = {
  deathmatch: 'atrium',
  cashraid: 'cashraid',
};

export function getMap(id: string | undefined, mode: GameMode): MapDef {
  if (id) {
    const found = MAPS.find((m) => m.id === id && m.modes.includes(mode));
    if (found) return found;
  }
  return MAPS.find((m) => m.id === DEFAULT_MAP[mode])!;
}

export function mapsForMode(mode: GameMode): MapDef[] {
  return MAPS.filter((m) => m.modes.includes(mode));
}
