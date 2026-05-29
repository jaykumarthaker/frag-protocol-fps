import * as THREE from 'three';
import { Arena } from './Arena';

/**
 * "The Atrium" — a UT2003-CTF-Citadel-inspired arena built for verticality.
 *
 * Unlike a flat deck map, the Atrium is four stacked tiers over the void:
 *
 *   +22  SPIRE CROWN   the citadel's top deck (amp). Jump-pad only.
 *    +9  MOUNTAIN BASES two team plateaus perched on rock massifs. You spawn
 *                       high and push DOWN toward mid, Citadel-style.
 *     0  ISLAND RING    a deck donut encircling the valley; every bridge lands
 *                       here — the contested middle.
 *   -12  VALLEY FLOOR   a playable sunken pit beneath the citadel (mega health +
 *                       cover). Climb back out by the two stone ramps.
 *
 * The spire rises straight out of the valley floor to the crown. A wide solid
 * causeway slopes from each mountain base down to the island ring (one
 * continuous walkable deck — no gaps); everything beyond the island's outer
 * edge, and off the sides of the causeways / bases, is bottomless void
 * (Actor.ts kills any actor whose feet drop below y = -25).
 *
 * The two bases are painted blue (south) / orange (north) so the towers read as
 * opposing citadels even though deathmatch isn't team-based.
 */
export class AtriumArena extends Arena {
  // ---- layout constants (shared by build + the waypoint graph) ----------
  private readonly VALLEY_Y = -12;     // valley floor top surface
  private readonly VALLEY_HALF = 20;   // 40×40 sunken pit
  private readonly ISLAND_HALF = 30;   // island ring outer half (ring = 20..30)
  private readonly SPIRE_HALF = 7;     // 14×14 citadel footprint
  private readonly SPIRE_TOP_Y = 22;   // crown deck height
  private readonly BASE_Y = 9;         // mountain-base plateau height
  private readonly BASE_Z = 78;        // |z| of each base centre
  private readonly BASE_HX = 26;       // base half-width (x)
  private readonly BASE_HZ = 16;       // base half-depth (z)
  private readonly SKY_Y = 22;         // sky-platform height
  private readonly SKY_R = 26;         // sky-platform distance from spire
  private readonly T = 1.6;            // deck thickness

  /** Dark gothic stone — cliffs, mountains, valley floor and the spire. */
  private matStone!: THREE.Material;

  override build() {
    this.makeMaterials();
    this.matStone = new THREE.MeshStandardMaterial({
      color: 0x2b2d36, roughness: 0.92, metalness: 0.05,
    });
    this.scene.add(this.root);

    const BLUE = 0x36e0ff;
    const ORANGE = 0xff7a18;
    const {
      VALLEY_Y, VALLEY_HALF, ISLAND_HALF, SPIRE_HALF, SPIRE_TOP_Y,
      BASE_Y, BASE_Z, BASE_HX, BASE_HZ, SKY_Y, SKY_R, T,
    } = this;

    // =====================================================================
    //  VALLEY FLOOR  (-12) — the playable sunken pit under the citadel
    // =====================================================================
    this.box(0, VALLEY_Y - 1, 0, VALLEY_HALF * 2, 2, VALLEY_HALF * 2, this.matStone);
    this.trimRing(0, VALLEY_Y + 0.06, 0, VALLEY_HALF - 1, 0x36e0ff);
    // The pit sits below every other light, so give it its own soft cool fill
    // (two lamps in the open annulus) — otherwise the valley is unfightable.
    for (const [lx, lz] of [[12, 12], [-12, -12]] as [number, number][]) {
      const vl = new THREE.PointLight(0x9fb4ff, 11, 48);
      vl.position.set(lx, VALLEY_Y + 6, lz);
      this.root.add(vl);
    }
    // A few rock cover blocks down in the valley (point-symmetric).
    for (const [x, z] of [[11, 5], [-11, -5], [5, -12], [-5, 12]] as [number, number][]) {
      this.box(x, VALLEY_Y + 1.6, z, 3.4, 3.2, 3.4, this.matStone);
    }

    // ---- cliff walls (valley perimeter, -12 → 0) ------------------------
    // East / West cliffs are solid; North / South each leave a centre gap for
    // a climb-out ramp.
    const cliffY = (VALLEY_Y + 0) / 2;       // centre of the 12-tall wall
    const cliffH = -VALLEY_Y;                // 12
    this.box( VALLEY_HALF, cliffY, 0, 2, cliffH, VALLEY_HALF * 2, this.matStone);
    this.box(-VALLEY_HALF, cliffY, 0, 2, cliffH, VALLEY_HALF * 2, this.matStone);
    const GAP = 5;                           // half-gap for the ramp
    const wingLen = VALLEY_HALF - GAP;       // 15
    for (const sz of [VALLEY_HALF, -VALLEY_HALF]) {
      this.box(-(GAP + wingLen / 2), cliffY, sz, wingLen, cliffH, 2, this.matStone);
      this.box( (GAP + wingLen / 2), cliffY, sz, wingLen, cliffH, 2, this.matStone);
    }

    // ---- climb-out ramps (valley floor → island ring, through the gaps) -
    // Walkable stone slopes (~41°) so players AND bots always have a ground
    // route out of the pit.
    this.ramp(new THREE.Vector3(0, VALLEY_Y, -(VALLEY_HALF - 8)),
              new THREE.Vector3(0, 0, -(VALLEY_HALF + 6)), 9);
    this.ramp(new THREE.Vector3(0, VALLEY_Y,  (VALLEY_HALF - 8)),
              new THREE.Vector3(0, 0,  (VALLEY_HALF + 6)), 9);

    // =====================================================================
    //  ISLAND RING  (0) — deck donut around the pit; bridges land here
    // =====================================================================
    const IY = -T / 2;                       // deck centre so top sits at y=0
    const ringMid = (ISLAND_HALF + VALLEY_HALF) / 2;   // 25
    const ringW = ISLAND_HALF - VALLEY_HALF;           // 10
    // N / S strips span the full width so they also cap the corners.
    this.box(0, IY, -ringMid, ISLAND_HALF * 2, T, ringW, this.matFloor);
    this.box(0, IY,  ringMid, ISLAND_HALF * 2, T, ringW, this.matFloor);
    // E / W strips span only between the N/S strips.
    this.box( ringMid, IY, 0, ringW, T, VALLEY_HALF * 2, this.matFloor);
    this.box(-ringMid, IY, 0, ringW, T, VALLEY_HALF * 2, this.matFloor);
    this.trimRing(0, 0.06, 0, VALLEY_HALF, 0xffd23f);     // inner (pit) edge
    this.trimRing(0, 0.06, 0, ISLAND_HALF - 0.4, 0x36e0ff); // outer (void) edge

    // =====================================================================
    //  CITADEL SPIRE  (rises from the valley floor to the crown)
    // =====================================================================
    const spireH = SPIRE_TOP_Y - VALLEY_Y;   // 34
    this.box(0, VALLEY_Y + spireH / 2, 0, SPIRE_HALF * 2, spireH, SPIRE_HALF * 2, this.matStone);
    // Crown deck — wider than the trunk so its underside reads as a crown.
    const CROWN_HALF = 10;
    this.box(0, SPIRE_TOP_Y + 0.6, 0, CROWN_HALF * 2, 1.2, CROWN_HALF * 2, this.matStruct);
    const cp = (cx: number, cz: number, sx: number, sz: number) =>
      this.box(cx, SPIRE_TOP_Y + 1.9, cz, sx, 1.4, sz, this.matStruct);
    cp(0,  CROWN_HALF, CROWN_HALF * 2, 0.6);
    cp(0, -CROWN_HALF, CROWN_HALF * 2, 0.6);
    cp( CROWN_HALF, 0, 0.6, CROWN_HALF * 2);
    cp(-CROWN_HALF, 0, 0.6, CROWN_HALF * 2);
    // Glowing finial on top.
    const finialMat = new THREE.MeshStandardMaterial({
      color: 0xffd23f, emissive: 0xffd23f, emissiveIntensity: 2.0, roughness: 0.4,
    });
    const finial = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.6, 3.5, 12), finialMat);
    finial.position.set(0, SPIRE_TOP_Y + 4.0, 0);
    this.root.add(finial);
    const finialLight = new THREE.PointLight(0xffd23f, 18, 70);
    finialLight.position.set(0, SPIRE_TOP_Y + 4.0, 0);
    this.root.add(finialLight);

    // =====================================================================
    //  MOUNTAIN BASES  (+9)  south = BLUE, north = ORANGE
    // =====================================================================
    const buildBase = (sign: 1 | -1, color: number) => {
      const cz = sign * BASE_Z;

      // Rock massif the plateau sits on — a tapering floating mountain.
      this.box(0, BASE_Y - 9, cz, (BASE_HX - 1) * 2, 18, (BASE_HZ + 1) * 2, this.matStone);
      this.box(0, BASE_Y - 19, cz, (BASE_HX - 8) * 2, 12, (BASE_HZ - 5) * 2, this.matStone);

      // Plateau deck
      this.box(0, BASE_Y - T / 2, cz, BASE_HX * 2, T, BASE_HZ * 2, this.matFloor);
      this.trimRing(0, BASE_Y + 0.06, cz, Math.min(BASE_HX, BASE_HZ) - 0.5, color);

      // Back wall behind the spawn line.
      this.box(0, BASE_Y + 4.5, cz + sign * (BASE_HZ - 0.6), BASE_HX * 2, 9, 1.2, this.matWall);

      // Two team-coloured corner towers (landmarks visible across the map).
      const towerMat = new THREE.MeshStandardMaterial({
        color: 0x1a1f2a, emissive: color, emissiveIntensity: 0.35, roughness: 0.55, metalness: 0.6,
      });
      const stripeMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 1.8, roughness: 0.4,
      });
      const TOWER_H = 30;
      const TOWER_HALF = 2.4;
      for (const tx of [-BASE_HX + 3.6, BASE_HX - 3.6]) {
        const tz = cz + sign * (BASE_HZ - 3.2);
        const trunk = new THREE.Mesh(
          new THREE.BoxGeometry(TOWER_HALF * 2, TOWER_H, TOWER_HALF * 2), towerMat,
        );
        trunk.position.set(tx, BASE_Y + TOWER_H / 2, tz);
        trunk.castShadow = true; trunk.receiveShadow = true;
        this.root.add(trunk);
        this.colliders.push(this.physics.addStaticBox(
          tx, BASE_Y + TOWER_H / 2, tz, TOWER_HALF, TOWER_H / 2, TOWER_HALF,
        ));
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.4, TOWER_H - 4, 0.15), stripeMat);
        stripe.position.set(tx, BASE_Y + TOWER_H / 2, tz - sign * (TOWER_HALF + 0.08));
        this.root.add(stripe);
        const cap = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), stripeMat);
        cap.position.set(tx, BASE_Y + TOWER_H + 1.4, tz);
        this.root.add(cap);
        const capLight = new THREE.PointLight(color, 14, 52);
        capLight.position.set(tx, BASE_Y + TOWER_H + 2.0, tz);
        this.root.add(capLight);
      }

      // Short side walls toward the rear; open toward the bridges.
      this.box(-BASE_HX + 0.6, BASE_Y + 3.0, cz + sign * (BASE_HZ - 6), 1.2, 6, 8, this.matWall);
      this.box( BASE_HX - 0.6, BASE_Y + 3.0, cz + sign * (BASE_HZ - 6), 1.2, 6, 8, this.matWall);
      // Low cover crates at the base front.
      this.box(-10, BASE_Y + 1.2, cz - sign * (BASE_HZ - 6), 3.6, 2.4, 3.6, this.matStruct);
      this.box( 10, BASE_Y + 1.2, cz - sign * (BASE_HZ - 6), 3.6, 2.4, 3.6, this.matStruct);

      // Spawn line along the back of the plateau.
      const spawnZ = cz + sign * (BASE_HZ - 8);
      for (const sx of [-16, -6, 6, 16]) {
        this.spawnPoints.push(new THREE.Vector3(sx, BASE_Y + 0.05, spawnZ));
      }
    };
    buildBase(-1, BLUE);
    buildBase( 1, ORANGE);

    // =====================================================================
    //  CAUSEWAYS  — one wide solid ramp per base, base (+9) → island ring (0)
    // =====================================================================
    // A single continuous deck nearly as wide as the base front, so the whole
    // approach reads as one walkable slope (no floating slabs / death gaps).
    // You descend the causeway to the ring, then drop into the central pit or
    // rotate around it.
    const CAUSEWAY_W = (BASE_HX - 2) * 2;   // 48 — almost the full base width
    for (const sign of [-1, 1] as const) {
      this.ramp(
        new THREE.Vector3(0, 0, sign * ISLAND_HALF),
        new THREE.Vector3(0, BASE_Y, sign * (BASE_Z - BASE_HZ)),
        CAUSEWAY_W,
      );
    }

    // =====================================================================
    //  SKY PLATFORMS  (+22) — two reward decks flanking the crown
    // =====================================================================
    for (const sx of [SKY_R, -SKY_R]) {
      this.box(sx, SKY_Y, 0, 9, 0.8, 9, this.matStruct);
      this.trimRing(sx, SKY_Y + 0.5, 0, 4.2, 0x36e0ff);
      const railH = 0.7;
      const railY = SKY_Y + 0.45 + railH / 2;
      this.box(sx, railY, 4.4, 9, railH, 0.25, this.matStruct);
      this.box(sx, railY, -4.4, 9, railH, 0.25, this.matStruct);
      this.box(sx + 4.4, railY, 0, 0.25, railH, 9, this.matStruct);
      this.box(sx - 4.4, railY, 0, 0.25, railH, 9, this.matStruct);
    }

    // =====================================================================
    //  JUMP PADS  (apex above launch = vy² / 120, with GRAVITY = 60)
    // =====================================================================
    // Island → side sky platforms (vy=55 → ~25m apex, clears the +22 deck).
    this.addJumpPad(new THREE.Vector3( VALLEY_HALF + 2, 0, 0), new THREE.Vector3( 9, 55, 0));
    this.addJumpPad(new THREE.Vector3(-(VALLEY_HALF + 2), 0, 0), new THREE.Vector3(-9, 55, 0));
    // Island → spire crown (long arc up and over the pit onto the crown deck).
    this.addJumpPad(new THREE.Vector3(0, 0, ISLAND_HALF - 4), new THREE.Vector3(0, 62, -20));

    // =====================================================================
    //  PICKUPS
    // =====================================================================
    this.pickupSpawns.push({ type: 'amp', pos: new THREE.Vector3(0, SPIRE_TOP_Y + 2.0, 0) });
    // Mega health down in the valley — strong, but you're on the low ground.
    this.pickupSpawns.push({ type: 'health_mega', pos: new THREE.Vector3(0, VALLEY_Y + 1.2, -13) });
    // Armour mid-causeway — contested on the way down from each base.
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3( 16, 5.7, -46) });
    this.pickupSpawns.push({ type: 'armor', pos: new THREE.Vector3(-16, 5.7,  46) });
    // Health at the base fronts + on the island ring (E / W strips).
    for (const [x, y, z] of [
      [10, BASE_Y + 1.2, -(BASE_Z - BASE_HZ + 1)], [-10, BASE_Y + 1.2, (BASE_Z - BASE_HZ + 1)],
      [VALLEY_HALF + 4, 1.2, 8], [-(VALLEY_HALF + 4), 1.2, -8],
    ] as [number, number, number][]) {
      this.pickupSpawns.push({ type: 'health', pos: new THREE.Vector3(x, y, z) });
    }
    // Per-weapon ammo — railgun slug perched on a sky deck (riskiest grab).
    const ammoSpots: [import('../entities/Pickup').PickupType, number, number, number][] = [
      ['ammo_rocket', 0, 1.2, -(VALLEY_HALF + 4)],      // island N inner (blue side)
      ['ammo_rocket', 0, 1.2,  (VALLEY_HALF + 4)],      // island S inner (orange side)
      ['ammo_shard',   VALLEY_HALF + 4, 1.2, -8],       // island E strip
      ['ammo_pulse',  -(VALLEY_HALF + 4), 1.2, 8],      // island W strip
      ['ammo_shard',  11, VALLEY_Y + 1.2, 5],            // down in the valley
      ['ammo_pulse', -11, VALLEY_Y + 1.2, -5],
      ['ammo_railgun', SKY_R, SKY_Y + 1.2, 0],
    ];
    for (const [type, x, y, z] of ammoSpots) {
      this.pickupSpawns.push({ type, pos: new THREE.Vector3(x, y, z) });
    }

    // A couple of high spawn points on the sky decks.
    this.spawnPoints.push(new THREE.Vector3( SKY_R, SKY_Y + 0.6, 0));
    this.spawnPoints.push(new THREE.Vector3(-SKY_R, SKY_Y + 0.6, 0));

    this.physics.step();
    this.buildAtriumWaypoints();
  }

  /**
   * Nav graph spanning all four tiers. The valley is walled in, so its nodes
   * only reach the island via nodes laid along the climb-out ramps — that
   * guarantees A* always has a ground route into and out of the pit.
   */
  private buildAtriumWaypoints() {
    const {
      VALLEY_Y, VALLEY_HALF, ISLAND_HALF, SPIRE_TOP_Y,
      BASE_Y, BASE_Z, BASE_HX, BASE_HZ, SKY_Y, SKY_R,
    } = this;
    const W = (x: number, y: number, z: number) =>
      this.waypoints.push(new THREE.Vector3(x, y, z));

    for (const sign of [-1, 1] as const) {
      const cz = sign * BASE_Z;
      // Base plateau: spawn line + front + front corners.
      W(0, BASE_Y, cz + sign * (BASE_HZ - 8));
      W(-16, BASE_Y, cz + sign * (BASE_HZ - 8));
      W( 16, BASE_Y, cz + sign * (BASE_HZ - 8));
      const fz = sign * (BASE_Z - BASE_HZ);
      W(0, BASE_Y, fz);
      W(-(BASE_HX - 4), BASE_Y, fz);
      W( BASE_HX - 4, BASE_Y, fz);
      // Causeway slope chain down the centre (+9 → 0) so A* walks the ramp.
      W(0, 6.75, sign * 54);
      W(0, 4.5,  sign * 46);
      W(0, 2.25, sign * 38);
    }

    // Island ring (on the deck donut, radius ~ridge between 20 and 30).
    const RI = VALLEY_HALF + 5;   // 25
    for (const [x, z] of [
      [0, -RI], [0, RI], [RI, 0], [-RI, 0],
      [RI - 3, RI - 3], [-(RI - 3), RI - 3], [RI - 3, -(RI - 3)], [-(RI - 3), -(RI - 3)],
    ] as [number, number][]) W(x, 0, z);

    // Climb-out ramp nodes (link the valley floor to the island ring).
    for (const sign of [-1, 1] as const) {
      W(0, 0, sign * (VALLEY_HALF + 4));            // ramp top (on island)
      W(0, VALLEY_Y / 2, sign * VALLEY_HALF);       // ramp middle (in the gap)
      W(0, VALLEY_Y, sign * (VALLEY_HALF - 8));      // ramp foot (valley floor)
    }
    // Valley-floor combat nodes (around the spire base; offset from the ramp
    // feet so they don't land on top of the ramp nodes).
    for (const [x, z] of [[12, 0], [-12, 0], [0, 10], [0, -10]] as [number, number][]) {
      W(x, VALLEY_Y, z);
    }

    // Sky platforms + crown (reward perches — loosely linked, pad-reached).
    W( SKY_R, SKY_Y + 0.6, 0); W(-SKY_R, SKY_Y + 0.6, 0);
    W(0, SPIRE_TOP_Y + 1.0, 0);
    W(6, SPIRE_TOP_Y + 1.0, 0); W(-6, SPIRE_TOP_Y + 1.0, 0);

    this.linkWaypoints(26);
  }
}
