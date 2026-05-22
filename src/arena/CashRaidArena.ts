import * as THREE from 'three';
import { Arena } from './Arena';
import type { Team } from '../core/types';

/** A vault deposit/steal zone — an axis-aligned trigger box. */
export interface VaultDef {
  team: Team;
  center: THREE.Vector3;
  halfExtents: THREE.Vector3;
}

/** A buy-station kiosk — a cylindrical trigger area. */
export interface BuyDef {
  team: Team;
  center: THREE.Vector3;
  radius: number;
}

/**
 * Purpose-built Cash Raid map: two mirrored team bases at opposite ends of the
 * arena, each with a vault zone and a buy station, joined by a central raised
 * route and two open flank lanes. Symmetric under a 180° rotation about Y, so
 * both teams get an identical layout.
 */
export class CashRaidArena extends Arena {
  /** Spawn points keyed by team (1 / 2). */
  teamSpawns: Record<number, THREE.Vector3[]> = { 1: [], 2: [] };
  vaultDefs: VaultDef[] = [];
  buyDefs: BuyDef[] = [];

  /** Mirror a team-1 local (x,z) to the given team's world coordinates. */
  private mir(team: Team, x: number, z: number): [number, number] {
    return team === 1 ? [x, z] : [-x, -z];
  }

  override build() {
    this.makeMaterials();
    this.scene.add(this.root);

    const HALF = 32;
    const WALL_H = 17;
    const BASE_Z = 26; // team-1 base sits at z = -26, team-2 at z = +26

    // ---- floor + outer walls ----
    this.box(0, -1, 0, HALF * 2, 2, HALF * 2, this.matFloor);
    this.box(0, WALL_H / 2, -HALF, HALF * 2, WALL_H, 1.5, this.matWall);
    this.box(0, WALL_H / 2, HALF, HALF * 2, WALL_H, 1.5, this.matWall);
    this.box(-HALF, WALL_H / 2, 0, 1.5, WALL_H, HALF * 2, this.matWall);
    this.box(HALF, WALL_H / 2, 0, 1.5, WALL_H, HALF * 2, this.matWall);

    // ---- central raised platform (the contested high route) ----
    const PT = 3.0;
    const PH = 6;
    this.box(0, PT / 2, 0, PH * 2, PT, PH * 2, this.matStruct);
    this.trimRing(0, PT + 0.06, 0, PH, 0xffd23f);
    // ramps onto the platform from all four sides
    this.ramp(new THREE.Vector3(13, 0, 0), new THREE.Vector3(PH, PT, 0), 4.5);
    this.ramp(new THREE.Vector3(-13, 0, 0), new THREE.Vector3(-PH, PT, 0), 4.5);
    this.ramp(new THREE.Vector3(0, 0, 13), new THREE.Vector3(0, PT, PH), 4.5);
    this.ramp(new THREE.Vector3(0, 0, -13), new THREE.Vector3(0, PT, -PH), 4.5);

    // ---- side sniper ledges + jump pads onto them (flank verticality) ----
    const LEDGE_Y = 6;
    this.box(HALF - 3.5, LEDGE_Y, 0, 6, 1, 30, this.matStruct);
    this.box(-(HALF - 3.5), LEDGE_Y, 0, 6, 1, 30, this.matStruct);
    this.addJumpPad(new THREE.Vector3(HALF - 9, 0, 0), new THREE.Vector3(2, 26.5, 0));
    this.addJumpPad(new THREE.Vector3(-(HALF - 9), 0, 0), new THREE.Vector3(-2, 26.5, 0));

    // ---- per-team bases (mirrored) ----
    for (const team of [1, 2] as Team[]) {
      const tbox = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
        const [wx, wz] = this.mir(team, x, z);
        this.box(wx, y, wz, sx, sy, sz, this.matStruct);
      };

      // vault enclosure — three low walls forming a pocket, open toward mid
      const [vx, vz] = this.mir(team, -8, -BASE_Z);
      tbox(-8, 1.6, -BASE_Z - 3, 9, 3.2, 1);   // back wall
      tbox(-12.5, 1.6, -BASE_Z, 1, 3.2, 7);    // outer side
      tbox(-3.5, 1.6, -BASE_Z, 1, 3.2, 7);     // inner side
      this.vaultDefs.push({
        team,
        center: new THREE.Vector3(vx, 0, vz),
        halfExtents: new THREE.Vector3(3, 2.6, 3),
      });

      // buy-station podium
      const [bx, bz] = this.mir(team, 10, -BASE_Z);
      const podium = new THREE.Mesh(
        new THREE.CylinderGeometry(2.4, 2.8, 0.5, 20), this.matStruct,
      );
      podium.position.set(bx, 0.25, bz);
      podium.castShadow = true;
      this.root.add(podium);
      this.colliders.push(this.physics.addStaticBox(bx, 0.25, bz, 2.6, 0.25, 2.6));
      this.buyDefs.push({
        team, center: new THREE.Vector3(bx, 0, bz), radius: 4.0,
      });

      // a cover wall splitting the base approach
      tbox(2, 1.5, -BASE_Z + 8, 1, 3, 8);

      // team spawn points strung across the base mouth
      for (const lx of [-12, -4, 4, 12]) {
        const [sx, sz] = this.mir(team, lx, -BASE_Z + 4);
        this.teamSpawns[team].push(new THREE.Vector3(sx, 0.05, sz));
      }
    }

    // ---- mid-field cover (point-symmetric pairs) ----
    const crates: [number, number][] = [
      [9, 9], [16, 2], [11, -13], [20, 13], [4, 16],
    ];
    for (const [x, z] of crates) {
      this.box(x, 1, z, 3, 2, 3, this.matStruct);
      this.box(-x, 1, -z, 3, 2, 3, this.matStruct);
    }
    const pillars: [number, number][] = [[16, -8], [-2, 12]];
    for (const [x, z] of pillars) {
      this.box(x, 2.5, z, 2, 5, 2, this.matStruct);
      this.box(-x, 2.5, -z, 2, 5, 2, this.matStruct);
    }

    // ---- pickups (combat sustain — symmetric) ----
    this.pickupSpawns.push({ type: 'amp', pos: new THREE.Vector3(0, PT + 1.0, 0) });
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(HALF - 3.5, LEDGE_Y + 1.2, 12) });
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(-(HALF - 3.5), LEDGE_Y + 1.2, -12) });
    for (const [x, z] of [[14, 6], [-14, -6], [20, -10], [-20, 10]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, 1.2, z) });
    }
    for (const [x, z] of [[0, 13], [0, -13], [22, 0], [-22, 0]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'ammo', pos: new THREE.Vector3(x, 1.2, z) });
    }
    for (const [x, z] of [[8, -18], [-8, 18]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(x, 1.2, z) });
    }

    // mirror spawnPoints so generic spawn code still works
    this.spawnPoints.push(...this.teamSpawns[1], ...this.teamSpawns[2]);

    this.physics.step();
    this.buildCashRaidWaypoints(PT);
  }

  /** Waypoint graph that links both bases through the centre + flank lanes. */
  private buildCashRaidWaypoints(platformTop: number) {
    const W = (x: number, y: number, z: number) =>
      this.waypoints.push(new THREE.Vector3(x, y, z));

    for (const team of [1, 2] as Team[]) {
      const [vx, vz] = this.mir(team, -8, -26);
      W(vx, 0, vz);                                   // vault
      const [vmx, vmz] = this.mir(team, -8, -21.5);
      W(vmx, 0, vmz);                                 // vault mouth (in the open)
      const [bx, bz] = this.mir(team, 10, -26);
      W(bx, 0, bz);                                   // buy station
      const [cx, cz] = this.mir(team, 0, -22);
      W(cx, 0, cz);                                   // base mouth
      const [fx, fz] = this.mir(team, 22, -16);
      W(fx, 0, fz);                                   // flank entry
    }
    // mid-field ring
    const ring: [number, number][] = [
      [22, 0], [-22, 0], [13, 11], [-13, 11], [13, -11], [-13, -11],
      [0, 14], [0, -14],
    ];
    for (const [x, z] of ring) W(x, 0, z);
    // central platform top
    W(0, platformTop, 0);
    W(4.5, platformTop, 4.5); W(-4.5, platformTop, -4.5);

    this.linkWaypoints(20);
  }
}
