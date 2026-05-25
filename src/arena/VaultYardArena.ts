import * as THREE from 'three';
import { CashRaidArena } from './CashRaidArena';
import type { Team } from '../core/types';

/**
 * Vault Yard — a compact, close-quarters Cash Raid map. Smaller than Vault
 * Standoff: vaults sit right against the back wall of each base, only ~64m
 * apart, with a low central cover ring instead of a tall mid platform.
 * Designed for brawl-pace fights where steal/bank cycles are shorter and
 * carriers are easier to chase down.
 *
 * Server-side geometry lives in `server/cashraid-map.mjs` under the
 * `vaultyard` entry — keep the two in sync by hand.
 */
export class VaultYardArena extends CashRaidArena {
  /** Mirror a team-1 local (x,z) to the given team's world coordinates. */
  private mirror(team: Team, x: number, z: number): [number, number] {
    return team === 1 ? [x, z] : [-x, -z];
  }

  override build() {
    this.makeMaterials();
    this.scene.add(this.root);

    const HALF_X = 40;
    const HALF_Z = 48;
    const WALL_H = 20;
    const BASE_Z = 32;

    // ---- floor + outer walls ----
    this.box(0, -1, 0, HALF_X * 2, 2, HALF_Z * 2, this.matFloor);
    this.box(0, WALL_H / 2, -HALF_Z, HALF_X * 2, WALL_H, 2, this.matWall);
    this.box(0, WALL_H / 2,  HALF_Z, HALF_X * 2, WALL_H, 2, this.matWall);
    this.box(-HALF_X, WALL_H / 2, 0, 2, WALL_H, HALF_Z * 2, this.matWall);
    this.box( HALF_X, WALL_H / 2, 0, 2, WALL_H, HALF_Z * 2, this.matWall);

    // ---- central low cover ring (head-high sightline breakers) ----
    // A small inner square of trim with four chest-high cover blocks around
    // the centre — fighting through mid is short, lots of corners.
    this.trimRing(0, 0.06, 0, 8, 0xffd23f);
    const coverPairs: [number, number][] = [
      [6, 2], [-6, -2], [2, 6], [-2, -6],
    ];
    for (const [x, z] of coverPairs) {
      this.box(x, 1.4, z, 3.2, 2.8, 3.2, this.matStruct);
    }
    // Two taller pillars on the long axis for vertical break + jump-pad anchors
    this.box(0, 4, 14, 2.2, 8, 2.2, this.matStruct);
    this.box(0, 4, -14, 2.2, 8, 2.2, this.matStruct);

    // ---- per-team bases (mirrored) ----
    for (const team of [1, 2] as Team[]) {
      const tbox = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
        const [wx, wz] = this.mirror(team, x, z);
        this.box(wx, y, wz, sx, sy, sz, this.matStruct);
      };

      // --- Vault: a back-wall pocket directly behind the base front ----
      const VX = 0;
      const VZ = -BASE_Z;
      const [vx, vz] = this.mirror(team, VX, VZ);
      const WH = 5.5;
      const VW = 11;
      const VD = 7;
      // Back wall flush against the outer wall
      tbox(VX, WH / 2, VZ - VD / 2, VW, WH, 1.2);
      // Side walls
      tbox(VX - VW / 2, WH / 2, VZ, 1.2, WH, VD);
      tbox(VX + VW / 2, WH / 2, VZ, 1.2, WH, VD);
      // Front wings leaving a wide opening at the deposit slot
      const wingW = (VW - 5) / 2;
      tbox(VX - VW / 2 + wingW / 2, WH / 2, VZ + VD / 2, wingW, WH, 1.2);
      tbox(VX + VW / 2 - wingW / 2, WH / 2, VZ + VD / 2, wingW, WH, 1.2);
      // Lintel over the entry
      tbox(VX, WH - 0.5, VZ + VD / 2, 5, 1.1, 1.2);
      // Corner posts
      tbox(VX - VW / 2, WH + 1.0, VZ - VD / 2, 1.4, 3.2, 1.4);
      tbox(VX + VW / 2, WH + 1.0, VZ - VD / 2, 1.4, 3.2, 1.4);
      tbox(VX - VW / 2, WH + 1.0, VZ + VD / 2, 1.4, 3.2, 1.4);
      tbox(VX + VW / 2, WH + 1.0, VZ + VD / 2, 1.4, 3.2, 1.4);

      this.vaultDefs.push({
        team,
        center: new THREE.Vector3(vx, 0, vz),
        halfExtents: new THREE.Vector3(VW / 2 - 0.4, 3.0, VD / 2 - 0.4),
      });

      // --- Buy-station kiosk on the side of the base ----
      const BX = -18, BZL = -BASE_Z + 1;
      const [bx, bz] = this.mirror(team, BX, BZL);
      const baseMat = this.matStruct;
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(3.6, 4.0, 0.5, 24), baseMat,
      );
      base.position.set(bx, 0.25, bz);
      base.castShadow = true; base.receiveShadow = true;
      this.root.add(base);
      this.colliders.push(this.physics.addStaticBox(bx, 0.25, bz, 3.6, 0.25, 3.6));

      const tier = new THREE.Mesh(
        new THREE.CylinderGeometry(2.7, 3.0, 0.45, 24), baseMat,
      );
      tier.position.set(bx, 0.5 + 0.225, bz);
      tier.castShadow = true; tier.receiveShadow = true;
      this.root.add(tier);
      this.colliders.push(this.physics.addStaticBox(bx, 0.5 + 0.225, bz, 2.7, 0.225, 2.7));

      const postH = 4.6;
      for (const [ox, oz] of [[-2.1, -2.1], [2.1, -2.1], [-2.1, 2.1], [2.1, 2.1]] as [number, number][]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, postH, 0.4), baseMat,
        );
        post.position.set(bx + ox, 0.7 + postH / 2, bz + oz);
        post.castShadow = true; post.receiveShadow = true;
        this.root.add(post);
      }
      const lintelMat = new THREE.MeshStandardMaterial({
        color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 1.4, roughness: 0.5,
      });
      const lintel = new THREE.Mesh(
        new THREE.TorusGeometry(2.5, 0.14, 8, 32), lintelMat,
      );
      lintel.position.set(bx, 0.7 + postH + 0.15, bz);
      lintel.rotation.x = Math.PI / 2;
      this.root.add(lintel);

      this.buyDefs.push({
        team, center: new THREE.Vector3(bx, 0, bz), radius: 5.0,
      });

      // --- Base-front cover and side flank cover ----
      // L-shaped cover in front of the vault — funnels attackers to flank.
      tbox(-6, 1.6, -BASE_Z + 8, 5, 3.2, 1.2);
      tbox(6,  1.6, -BASE_Z + 8, 5, 3.2, 1.2);
      tbox(0, 1.6, -BASE_Z + 12, 1.2, 3.2, 4);

      // Spawn line along the back, on either side of the vault.
      for (const lx of [-12, -4, 4, 12]) {
        const [sx, sz] = this.mirror(team, lx, -BASE_Z - 5);
        this.teamSpawns[team].push(new THREE.Vector3(sx, 0.05, sz));
      }
    }

    // ---- pickups (sustain — symmetric) ----
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(0, 1.2, 0) });
    for (const [x, z] of [[18, 6], [-18, -6], [18, -6], [-18, 6]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, 1.2, z) });
    }
    for (const [x, z] of [[0, 18], [0, -18], [22, 0], [-22, 0]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'ammo', pos: new THREE.Vector3(x, 1.2, z) });
    }
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3( 26, 1.2,  0) });
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(-26, 1.2,  0) });

    this.spawnPoints.push(...this.teamSpawns[1], ...this.teamSpawns[2]);
    this.physics.step();
    this.buildVaultYardWaypoints();
  }

  /** Waypoint graph mirroring `server/cashraid-map.mjs` vaultyard entry. */
  private buildVaultYardWaypoints() {
    const W = (x: number, y: number, z: number) =>
      this.waypoints.push(new THREE.Vector3(x, y, z));
    for (const team of [1, 2] as Team[]) {
      const BASE_Z = 32;
      const [vx, vz] = this.mirror(team, 0, -BASE_Z);
      W(vx, 0, vz);
      const [mx, mz] = this.mirror(team, 0, -BASE_Z + 6);
      W(mx, 0, mz);
      const [bx, bz] = this.mirror(team, -18, -BASE_Z + 1);
      W(bx, 0, bz);
      const [cx, cz] = this.mirror(team, 0, -BASE_Z + 14);
      W(cx, 0, cz);
      const [fx, fz] = this.mirror(team, 18, -BASE_Z + 8);
      W(fx, 0, fz);
      const [lx, lz] = this.mirror(team, -18, -BASE_Z + 14);
      W(lx, 0, lz);
    }
    for (const [x, z] of [
      [0, 0], [10, 0], [-10, 0],
      [22, 10], [-22, 10], [22, -10], [-22, -10],
      [0, 12], [0, -12],
    ] as [number, number][]) W(x, 0, z);
    this.linkWaypoints(20);
  }
}
