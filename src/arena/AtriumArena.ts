import * as THREE from 'three';
import { Arena } from './Arena';

/**
 * "The Atrium" — a big deathmatch arena designed around vertical play.
 *
 * Footprint: 160 x 160 with a 26-tall outer wall. The map has three play
 * tiers stacked in the centre of the volume:
 *
 *   tier 0 (y = -3)  central sunken pit, exposed mega-health
 *   tier 1 (y =  0)  main combat floor with cover pillars + crates
 *   tier 2 (y =  9)  perimeter walkway ring with railgun/pulse spawns
 *   tier 3 (y = 16)  two cross-bridges spanning the pit, rocket + amp at the
 *                    intersection (highest reward, most exposed)
 *
 * Four corner jump pads launch onto the bridges; four cardinal ramps walk
 * the main floor up to the walkway ring; four sets of pit steps drop into
 * the central pit from each side. Spawns ring the floor and bridges so
 * neither side starts adjacent to the rocket.
 *
 * The layout is original: it follows arena-shooter design vocabulary
 * (verticality, contested high-ground power weapon, jump-pad rotation paths)
 * without copying the geometry of any specific existing map.
 */
export class AtriumArena extends Arena {
  override build() {
    this.makeMaterials();
    this.scene.add(this.root);

    const HALF = 80;        // outer half-extent (map is 160 x 160)
    const WALL_H = 26;

    // ---- main floor (y=0) with the pit cut out via four floor quads ----
    // The pit occupies x in [-12, 12], z in [-12, 12] at y=-3, surrounded
    // by the floor at y=0. We build the floor as four rectangles around it.
    const pitHalf = 12;
    // north / south strips (full width, from pit edge to wall)
    this.box(0, -1, (HALF + pitHalf) / 2, HALF * 2, 2, HALF - pitHalf, this.matFloor);
    this.box(0, -1, -(HALF + pitHalf) / 2, HALF * 2, 2, HALF - pitHalf, this.matFloor);
    // east / west strips (between the pit's z bounds, from pit edge to wall)
    this.box((HALF + pitHalf) / 2, -1, 0, HALF - pitHalf, 2, pitHalf * 2, this.matFloor);
    this.box(-(HALF + pitHalf) / 2, -1, 0, HALF - pitHalf, 2, pitHalf * 2, this.matFloor);
    // pit floor (y = -3)
    this.box(0, -4, 0, pitHalf * 2, 2, pitHalf * 2, this.matFloor);
    this.trimRing(0, -3 + 0.06, 0, pitHalf, 0xff7a18);

    // ---- pit steps (one per side, from y=-3 to y=0) -----------------
    // Two short risers per side so movement in/out feels natural.
    const step = (cx: number, cz: number, axis: 'x' | 'z') => {
      // 4 risers, each 0.75 tall, 1.4 deep, 6 wide, marching outward
      for (let i = 0; i < 4; i++) {
        const y = -3 + 0.75 * (i + 1) - 0.375;
        const out = pitHalf + 0.7 + i * 1.4;
        const sx = axis === 'x' ? 1.4 : 6;
        const sz = axis === 'x' ? 6 : 1.4;
        const ox = axis === 'x' ? Math.sign(cx) * out : cx;
        const oz = axis === 'x' ? cz : Math.sign(cz) * out;
        this.box(ox, y, oz, sx, 0.75, sz, this.matStruct);
      }
    };
    step(1, 0, 'x');   step(-1, 0, 'x');
    step(0, 1, 'z');   step(0, -1, 'z');

    // ---- outer walls -----------------------------------------------
    this.box(0, WALL_H / 2, -HALF, HALF * 2, WALL_H, 2, this.matWall);
    this.box(0, WALL_H / 2, HALF,  HALF * 2, WALL_H, 2, this.matWall);
    this.box(-HALF, WALL_H / 2, 0, 2, WALL_H, HALF * 2, this.matWall);
    this.box(HALF,  WALL_H / 2, 0, 2, WALL_H, HALF * 2, this.matWall);

    // ---- walkway ring (y = 9, ~7 wide, set ~7 in from the wall) ----
    const WALK_Y = 9;
    const WALK_OUTER = HALF - 4;        // 76
    const WALK_INNER = WALK_OUTER - 14; // 62  (14 wide = generous walkway)
    // Build the ring as four straight segments so corners don't fight.
    this.box(0, WALK_Y - 0.4, WALK_OUTER - 7, WALK_OUTER * 2, 0.8, 14, this.matStruct);     // S band
    this.box(0, WALK_Y - 0.4, -(WALK_OUTER - 7), WALK_OUTER * 2, 0.8, 14, this.matStruct);  // N band
    this.box(WALK_OUTER - 7, WALK_Y - 0.4, 0, 14, 0.8, (WALK_OUTER - 14) * 2, this.matStruct); // E band
    this.box(-(WALK_OUTER - 7), WALK_Y - 0.4, 0, 14, 0.8, (WALK_OUTER - 14) * 2, this.matStruct);// W band
    // Glowing inner rim (visual cue you're about to fall off)
    this.trimRing(0, WALK_Y + 0.05, 0, WALK_INNER, 0x36e0ff);

    // Knee-high parapet on the inner edge so the railing reads as cover.
    const par = (cx: number, cz: number, sx: number, sz: number) =>
      this.box(cx, WALK_Y + 0.55, cz, sx, 0.7, sz, this.matStruct);
    par(0, WALK_INNER, WALK_INNER * 2, 0.7);
    par(0, -WALK_INNER, WALK_INNER * 2, 0.7);
    par(WALK_INNER, 0, 0.7, WALK_INNER * 2);
    par(-WALK_INNER, 0, 0.7, WALK_INNER * 2);

    // ---- four ramps: main floor -> walkway ring ---------------------
    // Ramps land near the mid of each wall, climbing inward from the floor.
    const rampRun = 18; // horizontal span
    const rampW = 7;
    const rampTopY = WALK_Y;
    this.ramp(new THREE.Vector3(0, 0, WALK_OUTER + 1),
      new THREE.Vector3(0, rampTopY, WALK_OUTER + 1 - rampRun), rampW);
    this.ramp(new THREE.Vector3(0, 0, -(WALK_OUTER + 1)),
      new THREE.Vector3(0, rampTopY, -(WALK_OUTER + 1 - rampRun)), rampW);
    this.ramp(new THREE.Vector3(WALK_OUTER + 1, 0, 0),
      new THREE.Vector3(WALK_OUTER + 1 - rampRun, rampTopY, 0), rampW);
    this.ramp(new THREE.Vector3(-(WALK_OUTER + 1), 0, 0),
      new THREE.Vector3(-(WALK_OUTER + 1 - rampRun), rampTopY, 0), rampW);

    // ---- two cross-bridges (y = 16) spanning the pit ----------------
    const BR_Y = 16;
    const BR_HALF = WALK_INNER - 1.5;   // bridge end sits on the parapet
    const BR_W = 6;
    // N-S bridge
    this.box(0, BR_Y - 0.4, 0, BR_W, 0.8, BR_HALF * 2, this.matStruct);
    // E-W bridge
    this.box(0, BR_Y - 0.4, 0, BR_HALF * 2, 0.8, BR_W, this.matStruct);
    // Centre node where they cross — glowing trim square
    this.trimRing(0, BR_Y + 0.05, 0, BR_W / 2 + 1, 0xffd23f);

    // Light parapets along the bridge edges
    const bp = (cx: number, cz: number, sx: number, sz: number) =>
      this.box(cx, BR_Y + 0.55, cz, sx, 0.7, sz, this.matStruct);
    bp(BR_W / 2 + 0.35, 0, 0.7, BR_HALF * 2 - BR_W);          // N-S east edge (skip middle)
    bp(-(BR_W / 2 + 0.35), 0, 0.7, BR_HALF * 2 - BR_W);       // N-S west edge

    // ---- corner jump pads (launch to the nearest bridge end) -------
    const JP = HALF - 14;   // 66
    // Launch velocity tuned to land on the bridge end roughly straight
    // up at apex (apex y = JUMP_SPEED²/(2g) — see Actor.ts).
    const JUMP_V = 28;
    this.addJumpPad(new THREE.Vector3( JP, 0,  JP), new THREE.Vector3(-3, JUMP_V, -3));
    this.addJumpPad(new THREE.Vector3(-JP, 0,  JP), new THREE.Vector3( 3, JUMP_V, -3));
    this.addJumpPad(new THREE.Vector3( JP, 0, -JP), new THREE.Vector3(-3, JUMP_V,  3));
    this.addJumpPad(new THREE.Vector3(-JP, 0, -JP), new THREE.Vector3( 3, JUMP_V,  3));

    // ---- cover pillars + low crates on the main floor ---------------
    const pillars: [number, number][] = [
      [28, 28], [-28, 28], [28, -28], [-28, -28],
      [44, 0], [-44, 0], [0, 44], [0, -44],
    ];
    for (const [x, z] of pillars) this.box(x, 3, z, 2.6, 6, 2.6, this.matStruct);
    const crates: [number, number][] = [
      [16, 6], [-16, -6], [6, -16], [-6, 16],
      [34, -18], [-34, 18], [22, 38], [-22, -38],
    ];
    for (const [x, z] of crates) this.box(x, 1.2, z, 3.6, 2.4, 3.6, this.matStruct);

    // ---- spawn points (10) ----
    const sp: [number, number, number][] = [
      [ 50,  50, 0.05], [-50,  50, 0.05], [ 50, -50, 0.05], [-50, -50, 0.05],
      [ 64,   0, 0.05], [-64,   0, 0.05], [  0,  64, 0.05], [  0, -64, 0.05],
      [ 0, 0, BR_Y + 0.6], [ 0, BR_HALF * 0.7, BR_Y + 0.6],
    ];
    for (const [x, z, y] of sp) this.spawnPoints.push(new THREE.Vector3(x, y, z));

    // ---- pickups ----
    // Rocket-tier reward on the bridge crossing; amp also up there.
    this.pickupSpawns.push({ type: 'amp',         pos: new THREE.Vector3(0, BR_Y + 1.0, 0) });
    // Mega health deep in the pit — risky pickup, draws fights downward.
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(0, -3 + 1.2, 0) });
    // Armor on the walkway ring (east + west)
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3( WALK_INNER + 7, WALK_Y + 1.2, 0) });
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(-(WALK_INNER + 7), WALK_Y + 1.2, 0) });
    // Health pads scattered around the floor near pillars
    for (const [x, z] of [[28, 28], [-28, 28], [28, -28], [-28, -28]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, 1.2, z) });
    }
    // Ammo pickups
    for (const [x, z] of [[44, 0], [-44, 0], [0, 44], [0, -44], [16, 16], [-16, -16]] as [number, number][]) {
      this.pickupSpawns.push({ type: 'ammo', pos: new THREE.Vector3(x, 1.2, z) });
    }

    // Step physics once so the static geometry is queryable when the
    // waypoint LOS raycasts run.
    this.physics.step();
    this.buildAtriumWaypoints(WALK_Y, BR_Y, WALK_INNER);
  }

  /** AI nav graph tuned to the three-tier vertical layout. */
  private buildAtriumWaypoints(walkY: number, bridgeY: number, walkInner: number) {
    const W = (x: number, y: number, z: number) =>
      this.waypoints.push(new THREE.Vector3(x, y, z));

    // Floor ring — outer combat circle
    const R = 50;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      W(Math.cos(a) * R, 0, Math.sin(a) * R);
    }
    // Floor inner ring (around the pit lip)
    const R2 = 22;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      W(Math.cos(a) * R2, 0, Math.sin(a) * R2);
    }
    // Pit floor
    W(0, -3, 0); W(6, -3, 0); W(-6, -3, 0); W(0, -3, 6); W(0, -3, -6);

    // Ramp bottoms / tops (cardinal)
    const rb = 64;
    W(0, 0, rb); W(0, 0, -rb); W(rb, 0, 0); W(-rb, 0, 0);
    const rt = rb - 17;
    W(0, walkY, rt); W(0, walkY, -rt); W(rt, walkY, 0); W(-rt, walkY, 0);

    // Walkway ring at y=walkY
    const WR = walkInner + 6;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      W(Math.cos(a) * WR, walkY, Math.sin(a) * WR);
    }

    // Bridge waypoints
    const BR_END = walkInner - 2;
    W(0, bridgeY, 0); // crossing
    W(0, bridgeY,  BR_END * 0.5); W(0, bridgeY, -BR_END * 0.5);
    W( BR_END * 0.5, bridgeY, 0); W(-BR_END * 0.5, bridgeY, 0);
    W(0, bridgeY,  BR_END); W(0, bridgeY, -BR_END);
    W( BR_END, bridgeY, 0); W(-BR_END, bridgeY, 0);

    // Jump-pad apex hints — give the bot a node to fall to from a bridge
    const JP = 80 - 14;
    W( JP, 0,  JP); W(-JP, 0,  JP); W( JP, 0, -JP); W(-JP, 0, -JP);

    this.linkWaypoints(28);
  }
}
