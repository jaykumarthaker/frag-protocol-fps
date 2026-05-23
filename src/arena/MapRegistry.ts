import type * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { GameMode } from '../core/types';
import { Arena } from './Arena';
import { AtriumArena } from './AtriumArena';
import { CashRaidArena } from './CashRaidArena';

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
      'Three-tier industrial arena. Bridges overlook a sunken pit; ' +
      'jump pads launch from the corners. Big sightlines, vertical fights.',
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
