import type * as THREE from 'three';
import type { Physics } from '../physics/Physics';
import type { GameMode } from '../core/types';
import { Arena } from './Arena';
import { AtriumArena } from './AtriumArena';

/**
 * Map registry. Each entry describes one playable arena and how to construct
 * it. There are two maps and both play in every mode — the Cash Raid vault /
 * kiosk structures are layered on at runtime by `Arena.addCashRaidStructures()`,
 * so the map list is identical regardless of the chosen game mode.
 */
export interface MapDef {
  id: string;
  name: string;
  description: string;
  /** Modes this map supports (all maps support both). */
  modes: GameMode[];
  factory: (scene: THREE.Scene, physics: Physics) => Arena;
}

const BOTH: GameMode[] = ['deathmatch', 'cashraid'];

export const MAPS: readonly MapDef[] = [
  {
    id: 'atrium',
    name: 'The Atrium',
    description:
      'A Citadel-style sky arena of stacked tiers: two mountain bases drop ' +
      'by wide causeways to a central ring, with a sunken valley beneath the ' +
      'spire and an amp on the crown. Step off the edge and you fall forever.',
    modes: BOTH,
    factory: (s, p) => new AtriumArena(s, p),
  },
  {
    id: 'duel',
    name: 'Foundry Duel',
    description:
      'Compact central platform with side ledges. Tight rotations and short ' +
      'sightlines — fast brawls in deathmatch, short steal cycles in Cash Raid.',
    modes: BOTH,
    factory: (s, p) => new Arena(s, p),
  },
];

export const DEFAULT_MAP: Record<GameMode, string> = {
  deathmatch: 'atrium',
  cashraid: 'duel',
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
