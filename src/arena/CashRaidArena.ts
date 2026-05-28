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
 * Purpose-built Cash Raid map: two mirrored team bases at opposite ends of a
 * wide arena, each with a fortified vault bunker and a buy-station kiosk,
 * joined by a central raised route and two open flank lanes. Symmetric under
 * a 180° rotation about Y so both teams get an identical layout.
 *
 * Sized for the 2.1 m character scale — wall heights, cover, ramps and
 * kiosks are sized so a player reads them as architecture, not knee bumps.
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

    const HALF = 60;
    const WALL_H = 24;
    const BASE_Z = 44; // team-1 base sits at z = -44, team-2 at z = +44

    // ---- floor + outer walls ----
    this.box(0, -1, 0, HALF * 2, 2, HALF * 2, this.matFloor);
    this.box(0, WALL_H / 2, -HALF, HALF * 2, WALL_H, 2, this.matWall);
    this.box(0, WALL_H / 2, HALF, HALF * 2, WALL_H, 2, this.matWall);
    this.box(-HALF, WALL_H / 2, 0, 2, WALL_H, HALF * 2, this.matWall);
    this.box(HALF, WALL_H / 2, 0, 2, WALL_H, HALF * 2, this.matWall);

    // ---- central raised platform (the contested high route) ----
    const PT = 5;       // platform top height
    const PH = 10;      // half-width (20 wide)
    this.box(0, PT / 2, 0, PH * 2, PT, PH * 2, this.matStruct);
    this.trimRing(0, PT + 0.06, 0, PH, 0xffd23f);
    // ramps onto the platform from all four sides
    this.ramp(new THREE.Vector3(22, 0, 0), new THREE.Vector3(PH, PT, 0), 7);
    this.ramp(new THREE.Vector3(-22, 0, 0), new THREE.Vector3(-PH, PT, 0), 7);
    this.ramp(new THREE.Vector3(0, 0, 22), new THREE.Vector3(0, PT, PH), 7);
    this.ramp(new THREE.Vector3(0, 0, -22), new THREE.Vector3(0, PT, -PH), 7);

    // ---- side sniper ledges + jump pads onto them (flank verticality) ----
    const LEDGE_Y = 9;
    this.box(HALF - 5, LEDGE_Y, 0, 9, 1.2, 56, this.matStruct);
    this.box(-(HALF - 5), LEDGE_Y, 0, 9, 1.2, 56, this.matStruct);
    // Knee-high parapet on the inner edge of each ledge so the railing reads.
    this.box(HALF - 9.4, LEDGE_Y + 0.85, 0, 0.6, 0.7, 56, this.matStruct);
    this.box(-(HALF - 9.4), LEDGE_Y + 0.85, 0, 0.6, 0.7, 56, this.matStruct);
    this.addJumpPad(new THREE.Vector3(HALF - 13, 0, 0), new THREE.Vector3(3, 32, 0));
    this.addJumpPad(new THREE.Vector3(-(HALF - 13), 0, 0), new THREE.Vector3(-3, 32, 0));

    // ---- per-team bases (mirrored) ----
    for (const team of [1, 2] as Team[]) {
      const tbox = (x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
        const [wx, wz] = this.mir(team, x, z);
        this.box(wx, y, wz, sx, sy, sz, this.matStruct);
      };

      // --- Vault bunker -------------------------------------------------
      // A fortified pocket built from a tall back wall, two side walls and
      // an arched entry frame opening toward mid. Sized for 2.1 m players.
      const VX = -14;            // local vault centre x
      const VZ = -BASE_Z;        // local vault centre z (deep in the base)
      const [vx, vz] = this.mir(team, VX, VZ);
      const WH = 6;              // wall height
      const VW = 14;             // vault width (along x)
      const VD = 9;              // vault depth (along z)

      // Back wall (faces mid)
      tbox(VX, WH / 2, VZ - VD / 2, VW, WH, 1.2);
      // Side walls
      tbox(VX - VW / 2, WH / 2, VZ, 1.2, WH, VD);
      tbox(VX + VW / 2, WH / 2, VZ, 1.2, WH, VD);
      // Front "wings" leaving an opening in the middle for the deposit slot
      const wingW = (VW - 6) / 2;
      tbox(VX - VW / 2 + wingW / 2, WH / 2, VZ + VD / 2, wingW, WH, 1.2);
      tbox(VX + VW / 2 - wingW / 2, WH / 2, VZ + VD / 2, wingW, WH, 1.2);
      // Lintel across the entry — reads as a doorway frame
      tbox(VX, WH - 0.6, VZ + VD / 2, 6, 1.2, 1.2);
      // Twin corner posts that rise above the parapet
      tbox(VX - VW / 2, WH + 1.2, VZ - VD / 2, 1.6, 3.6, 1.6);
      tbox(VX + VW / 2, WH + 1.2, VZ - VD / 2, 1.6, 3.6, 1.6);
      tbox(VX - VW / 2, WH + 1.2, VZ + VD / 2, 1.6, 3.6, 1.6);
      tbox(VX + VW / 2, WH + 1.2, VZ + VD / 2, 1.6, 3.6, 1.6);

      this.vaultDefs.push({
        team,
        center: new THREE.Vector3(vx, 0, vz),
        halfExtents: new THREE.Vector3(VW / 2 - 0.6, 3.0, VD / 2 - 0.6),
      });

      // --- Buy-station kiosk -------------------------------------------
      // Stepped podium with a tall holo-pillar frame so it reads as a kiosk,
      // not a hockey puck. Frame is built from posts + a top lintel ring.
      const BX = 16, BZL = -BASE_Z + 2;
      const [bx, bz] = this.mir(team, BX, BZL);

      // Two-step podium
      const baseMat = this.matStruct;
      const base = new THREE.Mesh(
        new THREE.CylinderGeometry(4.0, 4.4, 0.5, 24), baseMat,
      );
      base.position.set(bx, 0.25, bz);
      base.castShadow = true; base.receiveShadow = true;
      this.root.add(base);
      this.colliders.push(this.physics.addStaticBox(bx, 0.25, bz, 4.0, 0.25, 4.0));

      const tier = new THREE.Mesh(
        new THREE.CylinderGeometry(3.0, 3.3, 0.45, 24), baseMat,
      );
      tier.position.set(bx, 0.5 + 0.225, bz);
      tier.castShadow = true; tier.receiveShadow = true;
      this.root.add(tier);
      this.colliders.push(this.physics.addStaticBox(bx, 0.5 + 0.225, bz, 3.0, 0.225, 3.0));

      // Four corner posts framing the kiosk
      const postH = 5.0;
      for (const [ox, oz] of [[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]] as [number, number][]) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.4, postH, 0.4), baseMat,
        );
        post.position.set(bx + ox, 0.7 + postH / 2, bz + oz);
        post.castShadow = true; post.receiveShadow = true;
        this.root.add(post);
      }
      // Top ring lintel — torus laid flat above the posts
      const lintelMat = new THREE.MeshStandardMaterial({
        color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 1.4, roughness: 0.5,
      });
      const lintel = new THREE.Mesh(
        new THREE.TorusGeometry(2.8, 0.15, 8, 32), lintelMat,
      );
      lintel.position.set(bx, 0.7 + postH + 0.15, bz);
      lintel.rotation.x = Math.PI / 2;
      this.root.add(lintel);

      this.buyDefs.push({
        team, center: new THREE.Vector3(bx, 0, bz), radius: 5.5,
      });

      // --- Base cover -------------------------------------------------
      // Cover walls splitting the base approach so the kiosk isn't a sitting
      // duck from the centre lane.
      tbox(3, 2.0, -BASE_Z + 14, 1.2, 4, 10);
      tbox(-4, 1.6, -BASE_Z + 8, 5, 3.2, 1.2);

      // Team spawn points strung along the back of the base, behind the
      // vault, so players spawn protected and have to push out.
      for (const lx of [-20, -8, 4, 16]) {
        const [sx, sz] = this.mir(team, lx, -BASE_Z - 6);
        this.teamSpawns[team].push(new THREE.Vector3(sx, 0.05, sz));
      }
    }

    // ---- mid-field cover (point-symmetric pairs) ----
    const crates: [number, number][] = [
      [12, 16], [22, 4], [16, -20], [30, 22], [6, 26], [-18, 8],
    ];
    for (const [x, z] of crates) {
      this.box(x, 1.5, z, 4, 3, 4, this.matStruct);
      this.box(-x, 1.5, -z, 4, 3, 4, this.matStruct);
    }
    const pillars: [number, number][] = [[24, -14], [-4, 18], [34, 4]];
    for (const [x, z] of pillars) {
      this.box(x, 4, z, 2.6, 8, 2.6, this.matStruct);
      this.box(-x, 4, -z, 2.6, 8, 2.6, this.matStruct);
    }

    // ---- pickups (combat sustain — symmetric) ----
    this.pickupSpawns.push({ type: 'amp', pos: new THREE.Vector3(0, PT + 1.0, 0) });
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(HALF - 5, LEDGE_Y + 1.5, 18) });
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(-(HALF - 5), LEDGE_Y + 1.5, -18) });
    for (const [x, z] of [[20, 10], [-20, -10], [32, -16], [-32, 16]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, 1.2, z) });
    }
    // Per-weapon ammo with matched colours/icons; railgun is rare and central.
    const ammoSpots: [import('../entities/Pickup').PickupType, number, number][] = [
      ['ammo_rocket',   0,  22],
      ['ammo_pulse',    0, -22],
      ['ammo_shard',   38,   0],
      ['ammo_shard',  -38,   0],
      ['ammo_railgun', 22,   0],
      ['ammo_railgun',-22,   0],
    ];
    for (const [type, x, z] of ammoSpots) {
      this.pickupSpawns.push({ type, pos: new THREE.Vector3(x, 1.2, z) });
    }
    for (const [x, z] of [[14, -30], [-14, 30]] as [number, number][]) {
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
      const [vx, vz] = this.mir(team, -14, -44);
      W(vx, 0, vz);                                   // vault interior
      const [vmx, vmz] = this.mir(team, -14, -36);
      W(vmx, 0, vmz);                                 // vault mouth
      const [bx, bz] = this.mir(team, 16, -42);
      W(bx, 0, bz);                                   // buy station
      const [cx, cz] = this.mir(team, 0, -34);
      W(cx, 0, cz);                                   // base mouth
      const [fx, fz] = this.mir(team, 36, -24);
      W(fx, 0, fz);                                   // flank entry
      const [f2x, f2z] = this.mir(team, -36, -24);
      W(f2x, 0, f2z);                                 // opposite flank entry
    }
    // mid-field ring
    const ring: [number, number][] = [
      [38, 0], [-38, 0], [22, 18], [-22, 18], [22, -18], [-22, -18],
      [0, 24], [0, -24], [38, 18], [-38, -18], [38, -18], [-38, 18],
    ];
    for (const [x, z] of ring) W(x, 0, z);
    // central platform top
    W(0, platformTop, 0);
    W(7, platformTop, 7); W(-7, platformTop, -7);
    W(7, platformTop, -7); W(-7, platformTop, 7);

    this.linkWaypoints(24);
  }
}
